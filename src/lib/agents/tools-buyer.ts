import { getAddress, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assemblePaymentPayload,
  authorizationTypedData,
  checkoutOrderNonce,
  createPaymentPayload,
  encodePaymentSignatureHeader,
  prepareAuthorization,
  type Eip3009Authorization,
  readTokenBalance,
  selectRequirement,
  type PaymentRequired,
  type PaymentRequirements,
} from "@/lib/protocol/x402-evm";
import { resolveBuyerTarget } from "@/lib/agents/discover";
import { isSupportedNetwork } from "@/lib/chains";
import {
  chainLabelFor,
  chainSettings,
  config,
  explorerTx,
  toAtomic,
  toPaymentAmount,
} from "@/lib/config";
import { ensureSettleLiquidity } from "@/lib/liquidity/route";
import { emit } from "@/lib/protocol/events";

const exactAmount = (atomic: string) =>
  String(Number(atomic) / 10 ** config.tokenDecimals);

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const sameAddress = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Direct mode: payTo must be the locked merchant. Checkout mode: payTo must be
 * the trusted BorneoCheckout and the order nonce must bind the locked merchant,
 * token and amount, so the contract can only pay that merchant.
 */
function checkPayTo(
  accept: PaymentRequirements,
  expectedMerchant: string,
): { ok: true; viaCheckout: boolean } | { ok: false; reason: string } {
  if (accept.extra?.primaryType !== "ReceiveWithAuthorization") {
    return sameAddress(accept.payTo, expectedMerchant)
      ? { ok: true, viaCheckout: false }
      : {
          ok: false,
          reason: `402 payTo ${accept.payTo} does not match locked merchant ${expectedMerchant}`,
        };
  }
  const { checkout, merchant, orderKey, nonce } = accept.extra;
  const chain = chainSettings(accept.network);
  if (!chain.checkoutAddress || !sameAddress(accept.payTo, chain.checkoutAddress)) {
    return {
      ok: false,
      reason: `402 payTo ${accept.payTo} is not the trusted BorneoCheckout on ${chain.label} ${chain.checkoutAddress || "(unset)"}`,
    };
  }
  if (!sameAddress(checkout, accept.payTo)) {
    return { ok: false, reason: "402 extra.checkout does not match payTo" };
  }
  if (!sameAddress(merchant, expectedMerchant)) {
    return {
      ok: false,
      reason: `402 merchant ${merchant} does not match locked merchant ${expectedMerchant}`,
    };
  }
  if (!orderKey || !nonce) {
    return { ok: false, reason: "402 checkout requirement missing orderKey / nonce" };
  }
  const expectedNonce = checkoutOrderNonce({
    chainId: chain.chainId,
    checkout: accept.payTo,
    orderKey,
    merchant: expectedMerchant,
    token: accept.asset,
    amount: accept.amount,
  });
  if (expectedNonce.toLowerCase() !== nonce.toLowerCase()) {
    return { ok: false, reason: "402 order nonce does not bind the locked merchant / amount" };
  }
  return { ok: true, viaCheckout: true };
}

/**
 * The asset must be a stablecoin this agent knows on that chain: the chain's
 * default token, its USDG, or (on the primary chain) the asset in the locked
 * quote. A store cannot swap in some other token for the same numeric amount.
 */
function checkAsset(
  accept: PaymentRequirements,
  lockedAsset: string,
): { ok: true } | { ok: false; reason: string } {
  const chain = chainSettings(accept.network);
  const trusted = [chain.tokenAddress, chain.usdgAddress];
  if (accept.network === config.network) trusted.push(lockedAsset);
  return trusted.some((t) => sameAddress(t, accept.asset))
    ? { ok: true }
    : {
        ok: false,
        reason: `402 asset ${accept.asset} is not a trusted settle token on ${chain.label}`,
      };
}

/**
 * Which chain to pay on when a store accepts several. BUYER_NETWORK wins when
 * the store lists it. Otherwise take the first chain, in the store's order,
 * where the buyer already holds enough of the settle token. A single-chain
 * 402 is returned as is, with no balance lookups.
 */
async function chooseRequirement(
  challenge: PaymentRequired,
  buyer: string | undefined,
): Promise<{ accept?: PaymentRequirements; note?: string }> {
  const known = (challenge.accepts ?? []).filter(
    (a) => a.scheme === "exact" && isSupportedNetwork(a.network),
  );
  if (known.length <= 1) return { accept: known[0] };

  const preferred = config.buyerNetwork;
  if (preferred) {
    const match = selectRequirement({ accepts: known }, { network: preferred });
    if (match) {
      return { accept: match, note: `BUYER_NETWORK prefers ${chainLabelFor(preferred)}` };
    }
  }
  if (!buyer) return { accept: known[0] };

  const balances = await Promise.all(
    known.map((a) =>
      readTokenBalance({
        network: a.network,
        rpcUrl: chainSettings(a.network).rpcUrl,
        asset: a.asset,
        owner: buyer,
      }).catch(() => null),
    ),
  );
  const funded = known.findIndex(
    (a, i) => balances[i] !== null && balances[i]! >= BigInt(a.amount),
  );
  if (funded >= 0) {
    return {
      accept: known[funded],
      note: `wallet holds enough ${String(known[funded].extra?.settleSymbol || "stablecoin")} on ${chainLabelFor(known[funded].network)}`,
    };
  }
  return { accept: known[0], note: "no accepted chain is funded yet" };
}

export type BuyerStep = {
  type: "info" | "http" | "chain" | "error" | "success";
  text: string;
};

export type BuyerReceipt = {
  orderId?: string;
  explorerUrl?: string;
  txHash?: string;
  amount?: string;
  rail?: string;
  status?: string;
  swapTxHash?: string;
  swapExplorerUrl?: string;
  routeSummary?: string;
  ownershipPoints?: number;
  protocolFeeBps?: number;
  [key: string]: unknown;
};

/** Locked settle quote — no product titles or catalog prose. */
export type PayQuote = {
  storeSlug: string;
  skuId: string;
  price: string;
  merchantAddress?: string;
  settleAsset?: string;
  settleSymbol?: string;
};

/**
 * A payment waiting on a signature from the buyer's own wallet (a passkey
 * account in the browser). The server never holds that key: it returns the
 * unsigned authorization, the browser signs it, and submitX402Signature
 * finishes the handshake with the same order id.
 */
export type PendingX402 = {
  slug: string;
  skuId: string;
  orderId: string;
  buyerUid?: string;
  challenge: PaymentRequired;
  accept: PaymentRequirements;
  authorization: Eip3009Authorization;
  viaCheckout: boolean;
};

/** The buyer wallet holds too little of the settle token on the pay chain. */
export type FundingNeeded = {
  network: string;
  chainLabel: string;
  asset: string;
  symbol: string;
  address: string;
  balanceAtomic: string;
  requiredAtomic: string;
  shortfallAtomic: string;
};

export type PayX402Result = {
  steps: BuyerStep[];
  receipt?: BuyerReceipt;
  pending?: PendingX402;
  funding?: FundingNeeded;
};

export { extractRequestedProduct } from "@/lib/agents/discover";

/**
 * Deterministic x402 handshake on the store's settlement chain(s).
 * Prefer a locked quote (slug+skuId+price). Fuzzy message/product matching
 * remains only for legacy demo paths without a quote.
 */
export async function payX402Tool(args: {
  origin: string;
  slug?: string;
  message?: string;
  product?: string;
  quote?: PayQuote;
  buyerUid?: string;
  /**
   * The buyer's own wallet address. When set, the server never signs: it runs
   * discovery and the capability checks, then returns `pending` for the
   * browser to sign (or `funding` when the wallet is short).
   */
  buyerAddress?: string;
}): Promise<PayX402Result> {
  const steps: BuyerStep[] = [];
  const external = args.buyerAddress ? getAddress(args.buyerAddress) : undefined;
  const quote = args.quote;
  const buyerUid = args.buyerUid?.trim() || undefined;

  const resolved = await resolveBuyerTarget({
    slug: quote?.storeSlug || args.slug,
    skuId: quote?.skuId,
    message: quote ? undefined : args.message,
    product: quote ? undefined : args.product,
  });

  if (!resolved.ok) {
    steps.push({
      type: "info",
      text: quote
        ? `Resolving locked quote /s/${quote.storeSlug} · ${quote.skuId}`
        : args.slug || args.message?.includes("/s/")
          ? "Resolving store"
          : "Searching Borneo network registry (no /s/{slug} in prompt)",
    });
    steps.push({
      type: "error",
      text: resolved.available
        ? `${resolved.reason} Available: ${resolved.available}.`
        : resolved.reason,
    });
    return { steps };
  }

  const { slug, sku, via, merchantAddress } = resolved;
  const base = `${args.origin}/s/${slug}`;
  const expectedPrice = quote?.price || sku.price;
  const expectedPayTo = (quote?.merchantAddress || merchantAddress).trim();

  const settleAsset =
    quote?.settleAsset || sku.settleAsset || config.tokenAddress;
  const settleSymbol =
    quote?.settleSymbol || sku.settleSymbol || config.tokenSymbol;

  if (via === "quote") {
    steps.push({
      type: "info",
      text: `Capability lock → /s/${slug} · sku ${sku.id} · ${expectedPrice} ${settleSymbol}`,
    });
  } else if (via === "registry") {
    steps.push({
      type: "info",
      text: `Network registry → matched sku ${sku.id} @ /s/${slug}`,
    });
    emit({
      status: 200,
      method: "GET",
      path: "/registry.json",
      store: slug,
      message: `buyer matched sku ${sku.id}`,
    });
  }

  steps.push({ type: "info", text: `Discovering ${base}/llms.txt` });
  const llms = await fetch(`${base}/llms.txt`);
  steps.push({
    type: "http",
    text: `GET llms.txt → ${llms.status}`,
  });

  steps.push({ type: "info", text: "Loading ACP catalog" });
  const catalogRes = await fetch(`${base}/catalog.json`);
  steps.push({
    type: "http",
    text: `GET catalog.json → ${catalogRes.status} · sku ${sku.id}`,
  });

  let expectedAmount: string;
  let expectedAtomic: string;
  try {
    expectedAmount = toPaymentAmount(expectedPrice);
    expectedAtomic = toAtomic(expectedPrice);
  } catch {
    steps.push({
      type: "error",
      text: `Invalid locked price: ${expectedPrice}`,
    });
    return { steps };
  }

  let routeSwapTx: string | undefined;
  let routeSummary: string | undefined;
  if (!external) steps.push({
    type: "info",
    text: config.isArbitrum
      ? `Routing liquidity on Arbitrum (${settleSymbol} balance → Uniswap V3 if short)`
      : `Checking ${settleSymbol} balance on ${config.chainLabel}`,
  });
  if (!external) try {
    const route = await ensureSettleLiquidity({
      price: expectedPrice,
      quantity: 1,
      execute: true,
      toTokenAddress: settleAsset,
      toSymbol: settleSymbol,
    });
    if (route.balances) {
      steps.push({
        type: "chain",
        text: `Wallet ${route.balances.address.slice(0, 8)}… · ${settleSymbol} ${route.balances.tokenHuman} · native ${route.balances.nativeHuman}`,
      });
    }
    if (route.quote) {
      routeSummary = route.quote.routeSummary;
      const label =
        route.quote.mode === "live"
          ? "Live route"
          : route.quote.mode === "mainnet-preview"
            ? "Live Uniswap V3 quote on Arbitrum One (quote only, not executed)"
            : "Plan only (no DEX liquidity on this network)";
      steps.push({
        type: route.quote.mode === "plan" ? "info" : "chain",
        text: `${label}: ${route.quote.fromAmountHuman} ${route.quote.fromSymbol} → ~${route.quote.toAmountHuman} ${route.quote.toSymbol}`,
      });
      if (route.quote.mode === "mainnet-preview") {
        steps.push({
          type: "info",
          text: `Settlement network: ${config.chainLabel} (${config.chainId})`,
        });
      }
    }
    if (route.executed && route.swapTxHash) {
      routeSwapTx = route.swapTxHash;
      steps.push({
        type: "success",
        text: `Liquidity routed · ${route.explorerUrl || route.swapTxHash}`,
      });
    } else {
      steps.push({ type: "info", text: route.message });
    }
  } catch (error) {
    steps.push({
      type: "info",
      text: `Liquidity check skipped: ${error instanceof Error ? error.message : "unknown"}`,
    });
  }

  const orderId = crypto.randomUUID();
  steps.push({ type: "info", text: `POST ${base}/buy (no payment)` });
  const first = await fetch(`${base}/buy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      skuId: sku.id,
      quantity: 1,
      orderId,
      buyerUid,
      swapTxHash: routeSwapTx,
    }),
  });
  const challenge = (await first.json()) as PaymentRequired & {
    error?: string;
  };
  steps.push({
    type: "http",
    text: `HTTP ${first.status} ${first.status === 402 ? "Payment Required" : ""}`,
  });

  if (first.status !== 402) {
    steps.push({ type: "error", text: "Expected 402 challenge" });
    return { steps };
  }

  const buyerKey = external ? undefined : config.buyerPrivateKey;
  const account = buyerKey ? privateKeyToAccount(buyerKey) : undefined;
  const payer = external ?? account?.address;

  const offered = (challenge.accepts ?? []).map((a) => chainLabelFor(a.network));
  const { accept, note } = await chooseRequirement(challenge, payer);
  if (!accept) {
    steps.push({
      type: "error",
      text: offered.length
        ? `402 offers no chain this agent supports (${offered.join(", ")})`
        : "402 missing accepts[]",
    });
    return { steps };
  }
  const payChain = chainLabelFor(accept.network);
  if (offered.length > 1) {
    steps.push({
      type: "info",
      text: `Store accepts ${offered.join(", ")}. Paying on ${payChain}${note ? ` (${note})` : ""}`,
    });
  }

  const challengeSymbol = String(accept.extra?.settleSymbol || config.tokenSymbol);
  const humanAmount = `${exactAmount(accept.amount)} ${challengeSymbol}`;
  const viaCheckoutChallenge = accept.extra?.primaryType === "ReceiveWithAuthorization";
  steps.push({
    type: "info",
    text: viaCheckoutChallenge
      ? `Store challenge: pay ${humanAmount} to BorneoCheckout ${shortAddr(accept.payTo)} for merchant ${shortAddr(String(accept.extra?.merchant))} · order nonce ${shortAddr(String(accept.extra?.nonce))}`
      : `Store challenge: pay ${humanAmount} to merchant ${shortAddr(accept.payTo)}`,
  });

  const assetCheck = checkAsset(accept, settleAsset);
  if (!assetCheck.ok) {
    steps.push({ type: "error", text: `Capability check failed: ${assetCheck.reason}` });
    return { steps };
  }

  const payToCheck = checkPayTo(accept, expectedPayTo);
  if (!payToCheck.ok) {
    steps.push({ type: "error", text: `Capability check failed: ${payToCheck.reason}` });
    return { steps };
  }

  if (accept.amount !== expectedAtomic) {
    steps.push({
      type: "error",
      text: `Capability check failed: 402 amount ${accept.amount} does not match locked price ${expectedPrice} ${config.tokenSymbol} (${expectedAmount} → ${expectedAtomic} atomic)`,
    });
    return { steps };
  }

  steps.push({
    type: "info",
    text: payToCheck.viaCheckout
      ? `Capability check passed: agent recomputed the order nonce. It binds merchant ${shortAddr(expectedPayTo)} and ${humanAmount} to the locked quote`
      : "Capability check passed: payTo + amount match locked quote",
  });

  if (external) {
    return await prepareExternalSignature({
      steps,
      slug,
      skuId: sku.id,
      orderId,
      buyerUid,
      challenge,
      accept,
      payer: external,
      payChain,
      humanAmount,
      viaCheckout: payToCheck.viaCheckout,
    });
  }

  if (!account) {
    emit({
      status: 402,
      method: "POST",
      path: `${base}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: `402 unpaid: BUYER_PRIVATE_KEY missing, cannot sign on ${payChain}`,
    });
    steps.push({
      type: "error",
      text: `402 is the challenge. Add BUYER_PRIVATE_KEY + funded ${challengeSymbol} on ${payChain} (${accept.network}), then Buy again.`,
    });
    return { steps, receipt: challenge as BuyerReceipt };
  }

  steps.push({
    type: "chain",
    text: `Signing gasless EIP-3009 ${
      payToCheck.viaCheckout ? "ReceiveWithAuthorization" : "TransferWithAuthorization"
    }: ${humanAmount} from ${shortAddr(account.address)} on ${payChain} (buyer needs no ${chainSettings(accept.network).nativeSymbol})`,
  });

  let paymentHeader: string;
  try {
    const payload = await createPaymentPayload(account, challenge, accept);
    paymentHeader = encodePaymentSignatureHeader(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "sign failed";
    emit({
      status: 402,
      method: "POST",
      path: `${base}/buy`,
      store: slug,
      orderId,
      rail: "x402",
      message: `402 unsigned: ${reason}`,
    });
    steps.push({ type: "error", text: reason });
    return { steps, receipt: challenge as BuyerReceipt };
  }

  steps.push({
    type: "chain",
    text: payToCheck.viaCheckout
      ? `Signed. Relayer submits BorneoCheckout.settle() on ${payChain}`
      : `Signed. Relayer submits transferWithAuthorization on ${payChain}`,
  });

  return await finishPurchase({
    steps,
    base,
    skuId: sku.id,
    orderId,
    buyerUid,
    paymentHeader,
    accept,
    viaCheckout: payToCheck.viaCheckout,
    routeSwapTx,
    routeSummary,
  });
}

/** POST /buy again with the signed payment and turn the reply into steps. */
async function finishPurchase(args: {
  steps: BuyerStep[];
  base: string;
  skuId: string;
  orderId: string;
  buyerUid?: string;
  paymentHeader: string;
  accept: PaymentRequirements;
  viaCheckout: boolean;
  routeSwapTx?: string;
  routeSummary?: string;
}): Promise<PayX402Result> {
  const { steps, base, accept, routeSwapTx, routeSummary } = args;
  const payChain = chainLabelFor(accept.network);
  const challengeSymbol = String(accept.extra?.settleSymbol || config.tokenSymbol);
  const second = await fetch(`${base}/buy`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "PAYMENT-SIGNATURE": args.paymentHeader,
    },
    body: JSON.stringify({
      skuId: args.skuId,
      quantity: 1,
      orderId: args.orderId,
      buyerUid: args.buyerUid,
      swapTxHash: routeSwapTx,
    }),
  });
  const secondText = await second.text();
  let receipt: BuyerReceipt;
  try {
    receipt = JSON.parse(secondText) as BuyerReceipt;
  } catch {
    const snippet = secondText.slice(0, 160).replace(/\s+/g, " ");
    steps.push({
      type: "error",
      text: `HTTP ${second.status} non-JSON from /buy: ${snippet}`,
    });
    return {
      steps,
      receipt: { status: "verify-failed" },
    };
  }
  if (receipt.txHash && !receipt.explorerUrl) {
    receipt.explorerUrl = explorerTx(String(receipt.txHash), accept.network);
  }
  if (routeSwapTx) {
    receipt.swapTxHash = routeSwapTx;
    receipt.swapExplorerUrl = explorerTx(routeSwapTx);
  }
  if (routeSummary) receipt.routeSummary = routeSummary;
  steps.push({
    type: second.ok ? "success" : "error",
    text: `HTTP ${second.status} ${second.ok ? "receipt unlocked" : JSON.stringify(receipt)}`,
  });
  if (second.ok && args.viaCheckout && receipt.feeAtomic && receipt.netToMerchantAtomic) {
    steps.push({
      type: "success",
      text: `Settled on ${payChain}: merchant ${exactAmount(String(receipt.netToMerchantAtomic))} ${challengeSymbol} + treasury fee ${exactAmount(String(receipt.feeAtomic))} ${challengeSymbol}, in one transaction`,
    });
  }
  if (second.ok && receipt.explorerUrl) {
    steps.push({ type: "success", text: receipt.explorerUrl });
  } else if (second.ok && receipt.txHash) {
    steps.push({
      type: "success",
      text: explorerTx(String(receipt.txHash), accept.network),
    });
  }
  if (second.ok && receipt.ownershipPoints) {
    steps.push({
      type: "success",
      text: `XPoints +${receipt.ownershipPoints} (${receipt.protocolFeeBps ?? config.protocolFeeBps} bps protocol fee)`,
    });
  }
  return { steps, receipt };
}

/**
 * External wallet: check the balance on the chosen chain, then hand back the
 * unsigned authorization. Nothing is signed or broadcast here.
 */
async function prepareExternalSignature(args: {
  steps: BuyerStep[];
  slug: string;
  skuId: string;
  orderId: string;
  buyerUid?: string;
  challenge: PaymentRequired;
  accept: PaymentRequirements;
  payer: string;
  payChain: string;
  humanAmount: string;
  viaCheckout: boolean;
}): Promise<PayX402Result> {
  const { steps, accept, payer, payChain } = args;
  const symbol = String(accept.extra?.settleSymbol || config.tokenSymbol);
  let balance: bigint | null = null;
  try {
    balance = await readTokenBalance({
      network: accept.network,
      rpcUrl: chainSettings(accept.network).rpcUrl,
      asset: accept.asset,
      owner: payer,
    });
  } catch {
    balance = null;
  }
  const required = BigInt(accept.amount);
  if (balance !== null) {
    steps.push({
      type: "chain",
      text: `Passkey wallet ${shortAddr(payer)} · ${exactAmount(balance.toString())} ${symbol} on ${payChain}`,
    });
  }
  if (balance !== null && balance < required) {
    const shortfall = required - balance;
    steps.push({
      type: "error",
      text: `Short ${exactAmount(shortfall.toString())} ${symbol} on ${payChain}. Top up from any chain, then pay.`,
    });
    return {
      steps,
      funding: {
        network: accept.network,
        chainLabel: payChain,
        asset: accept.asset,
        symbol,
        address: payer,
        balanceAtomic: balance.toString(),
        requiredAtomic: required.toString(),
        shortfallAtomic: shortfall.toString(),
      },
    };
  }

  const authorization = prepareAuthorization(payer, accept);
  steps.push({
    type: "chain",
    text: `Authorization ready: ${args.humanAmount} from ${shortAddr(payer)} on ${payChain}. Waiting for the passkey wallet to sign`,
  });
  return {
    steps,
    pending: {
      slug: args.slug,
      skuId: args.skuId,
      orderId: args.orderId,
      buyerUid: args.buyerUid,
      challenge: args.challenge,
      accept,
      authorization,
      viaCheckout: args.viaCheckout,
    },
  };
}

/**
 * Finish a payment the buyer's own wallet signed. The signature is checked
 * against the authorization before anything is relayed, so a bad signature
 * fails here instead of at the store.
 */
export async function submitX402Signature(args: {
  /** This server's own origin. Never taken from the client. */
  origin: string;
  pending: PendingX402;
  signature: Hex;
}): Promise<PayX402Result> {
  const { pending, signature } = args;
  const steps: BuyerStep[] = [];
  if (!/^[a-z0-9-]{1,64}$/.test(pending.slug) || !isSupportedNetwork(pending.accept.network)) {
    steps.push({ type: "error", text: "Invalid pending payment" });
    return { steps };
  }
  const payChain = chainLabelFor(pending.accept.network);
  const typed = authorizationTypedData(pending.accept, pending.authorization);
  const valid = await verifyTypedData({
    address: getAddress(pending.authorization.from),
    ...typed,
    signature,
  }).catch(() => false);
  if (!valid) {
    steps.push({ type: "error", text: "Passkey signature does not match the authorization" });
    return { steps };
  }
  steps.push({
    type: "chain",
    text: `Passkey wallet signed ${typed.primaryType} on ${payChain} (no gas, no wallet popup)`,
  });
  steps.push({
    type: "chain",
    text: pending.viaCheckout
      ? `Relayer submits BorneoCheckout.settle() on ${payChain}`
      : `Relayer submits transferWithAuthorization on ${payChain}`,
  });
  const payload = assemblePaymentPayload(
    pending.challenge,
    pending.accept,
    pending.authorization,
    signature,
  );
  return await finishPurchase({
    steps,
    base: `${args.origin}/s/${pending.slug}`,
    skuId: pending.skuId,
    orderId: pending.orderId,
    buyerUid: pending.buyerUid,
    paymentHeader: encodePaymentSignatureHeader(payload),
    accept: pending.accept,
    viaCheckout: pending.viaCheckout,
  });
}
