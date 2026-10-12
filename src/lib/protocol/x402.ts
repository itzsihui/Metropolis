import {
  chainSettings,
  config,
  explorerTx,
  settleAssetFor,
  toAtomic,
} from "@/lib/config";
import { resolveTokenDomain } from "@/lib/protocol/token-domain";
import {
  EvmFacilitator,
  checkoutOrderKey,
  checkoutOrderNonce,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  selectRequirement,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "@/lib/protocol/x402-evm";
import type { Sku, StoreRecord } from "@/lib/store/types";

export type { PaymentRequired, PaymentRequirements, PaymentPayload };

/** One `exact` requirement for paying this order on `network`. */
async function buildRequirement(args: {
  network: string;
  store: StoreRecord;
  sku: Sku;
  orderId: string;
  amount: string;
}): Promise<PaymentRequirements | null> {
  const { network, store, sku, orderId, amount } = args;
  const settle = settleAssetFor(network, sku);
  if (!settle) return null;
  const { asset, symbol } = settle;
  const chain = chainSettings(network);
  const checkout = chain.checkoutAddress;
  const orderKey = checkout ? checkoutOrderKey(orderId) : undefined;
  const domain = await resolveTokenDomain(network, asset, symbol);
  return {
    scheme: "exact",
    network,
    amount,
    asset,
    payTo: checkout || store.merchantAddress,
    maxTimeoutSeconds: 300,
    extra: {
      ...domain,
      orderId,
      chainLabel: chain.label,
      settleSymbol: symbol,
      quoteCurrency: sku.quoteCurrency || symbol,
      quotePrice: sku.quotePrice || sku.price,
      ...(checkout && orderKey
        ? {
            primaryType: "ReceiveWithAuthorization" as const,
            checkout,
            merchant: store.merchantAddress,
            orderKey,
            nonce: checkoutOrderNonce({
              chainId: chain.chainId,
              checkout,
              orderKey,
              merchant: store.merchantAddress,
              token: asset,
              amount,
            }),
            feeBps: config.protocolFeeBps,
          }
        : {}),
    },
  };
}

/**
 * The 402 challenge for an order: one `accepts` entry per settlement chain
 * (CHAIN_NETWORK first, then SETTLE_NETWORKS). A buyer pays on exactly one.
 */
export async function buildPaymentRequired(
  store: StoreRecord,
  sku: Sku,
  origin: string,
  orderId: string,
  quantity: number,
): Promise<PaymentRequired> {
  const amount = (
    BigInt(toAtomic(sku.price)) * BigInt(quantity)
  ).toString();
  const built = await Promise.all(
    config.settleNetworks.map((network) =>
      buildRequirement({ network, store, sku, orderId, amount }),
    ),
  );
  return {
    x402Version: 2,
    resource: {
      url: `${origin}/s/${store.slug}/buy`,
      description: `${sku.title} x${quantity}`,
      mimeType: "application/json",
    },
    accepts: built.filter((a): a is PaymentRequirements => a !== null),
  };
}

/**
 * The server's own requirement for the chain and asset a buyer signed for.
 * Settlement always verifies against this, never against the buyer's copy.
 */
export function matchRequirement(
  challenge: PaymentRequired,
  payload: PaymentPayload,
): PaymentRequirements | undefined {
  return selectRequirement(challenge, {
    network: payload.accepted.network,
    asset: payload.accepted.asset,
  });
}

/** Atomic amount for order records (micro-units). */
export function paymentAmountAtomic(
  store: StoreRecord,
  sku: Sku,
  quantity: number,
): string {
  return (
    BigInt(toAtomic(sku.price)) * BigInt(quantity)
  ).toString();
}

export function parsePaymentSignature(header: string): PaymentPayload | null {
  const raw = header.trim();
  if (!raw) return null;
  try {
    return decodePaymentSignatureHeader(raw);
  } catch {
    return null;
  }
}

const facilitators = new Map<string, EvmFacilitator>();

/** One relayer per chain, created on first use. The same key serves all chains. */
function facilitator(network: string): EvmFacilitator {
  const existing = facilitators.get(network);
  if (existing) return existing;
  const chain = chainSettings(network);
  const key = config.facilitatorPrivateKey;
  if (!key) {
    throw new Error(
      `Facilitator key missing. Set FACILITATOR_PRIVATE_KEY (or BUYER_PRIVATE_KEY) with ${chain.nativeSymbol} on ${chain.label} for gas.`,
    );
  }
  const created = new EvmFacilitator({
    relayerKey: key,
    network,
    rpcUrl: chain.rpcUrl,
  });
  facilitators.set(network, created);
  return created;
}

/**
 * Verify + settle a signed EIP-3009 payment on the requirement's chain.
 */
export async function verifyAndSettle(args: {
  paymentHeader: string;
  paymentRequirements: PaymentRequirements;
  paymentPayload?: PaymentPayload | null;
}) {
  try {
    const payload =
      args.paymentPayload || parsePaymentSignature(args.paymentHeader);
    if (!payload) {
      return { ok: false as const, reason: "Invalid PAYMENT-SIGNATURE" };
    }

    const network = args.paymentRequirements.network;
    const settled = await facilitator(network).settle(
      payload,
      args.paymentRequirements,
    );
    if (!settled.success) {
      return { ok: false as const, reason: settled.errorReason };
    }

    return {
      ok: true as const,
      network,
      txHash: settled.transaction,
      explorerUrl: explorerTx(settled.transaction, network),
      payer: settled.payer,
      checkout: settled.checkout,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "verifyAndSettle failed";
    return { ok: false as const, reason };
  }
}

/** @deprecated Use verifyAndSettle — kept name alias for call-site clarity. */
export async function verifyTransfer(args: {
  paymentHeader: string;
  paymentRequirements: PaymentRequirements;
}) {
  return verifyAndSettle(args);
}

export function paymentRequiredHeaders(body: PaymentRequired) {
  return {
    "content-type": "application/json",
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body),
    "cache-control": "no-store",
  };
}
