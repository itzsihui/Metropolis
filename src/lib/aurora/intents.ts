import { getAddress, isAddress } from "viem";
import { USDC_MONAD } from "@/lib/chains";

/**
 * Aurora Intents Swap API (NEAR Intents 1Click). Turns whatever a shopper
 * holds on any of 30+ chains into USDC in their passkey wallet on Monad.
 * Docs: https://docs.intents.aurora.dev/api-reference/swap-api-reference
 *
 * The API runs on mainnets only, so the destination is always Circle USDC on
 * Monad mainnet. The server fixes the destination asset and checks the
 * recipient, so this proxy can only ever deliver Monad USDC to an EVM address.
 */
const API_BASE = (process.env.AURORA_INTENTS_API_URL || "https://intents-api.aurora.dev").replace(/\/$/, "");

export type IntentsToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
};

export type IntentsStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export type IntentsQuote = {
  timeEstimate: number;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  maxAmountIn?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  depositAddress?: string;
  depositMemo?: string;
  chainDepositAddresses?: Array<{ blockchain: string; address: string; memo?: string }>;
  refundFee?: string;
};

export type IntentsQuoteResponse = {
  timestamp: string;
  signature: string;
  correlationId?: string | null;
  quote: IntentsQuote;
};

export type IntentsStatusResponse = {
  correlationId?: string;
  status: IntentsStatus;
  updatedAt?: string;
  swapDetails?: {
    intentHashes?: string[];
    nearTxHashes?: string[];
    originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    amountInFormatted?: string;
    amountOutFormatted?: string;
    refundedAmountFormatted?: string;
    refundReason?: string;
    depositedAmountFormatted?: string;
  };
};

/** Blockchains whose addresses are 0x EVM addresses (refund defaults to the passkey wallet). */
export const EVM_BLOCKCHAINS = new Set([
  "eth",
  "base",
  "arb",
  "op",
  "pol",
  "bsc",
  "avax",
  "gnosis",
  "bera",
  "scroll",
  "xlayer",
  "plasma",
  "adi",
  "monad",
]);

export function intentsConfigured() {
  return Boolean(process.env.AURORA_INTENTS_API_KEY?.trim());
}

function apiKey() {
  const key = process.env.AURORA_INTENTS_API_KEY?.trim();
  if (!key) throw new Error("AURORA_INTENTS_API_KEY is not set (create one at studio.aurora.dev)");
  return encodeURIComponent(key);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path.replace("{key}", apiKey())}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 200) };
  }
  if (!res.ok) {
    const message =
      (body as { message?: string | string[] })?.message ?? `Aurora Intents HTTP ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join("; ") : String(message));
  }
  return body as T;
}

let tokenCache: { at: number; tokens: IntentsToken[] } | null = null;

export async function listIntentsTokens(): Promise<IntentsToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 5 * 60_000) return tokenCache.tokens;
  const body = await call<{ tokens?: IntentsToken[] } | IntentsToken[]>("/api/tokens/{key}");
  const tokens = Array.isArray(body) ? body : (body.tokens ?? []);
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

/** Circle USDC on Monad mainnet, as the Intents asset the shopper receives. */
export async function monadUsdcAsset(): Promise<IntentsToken> {
  const tokens = await listIntentsTokens();
  const match =
    tokens.find(
      (t) =>
        t.blockchain === "monad" &&
        t.contractAddress?.toLowerCase() === USDC_MONAD.toLowerCase(),
    ) ?? tokens.find((t) => t.blockchain === "monad" && t.symbol.toUpperCase() === "USDC");
  if (!match) throw new Error("Aurora Intents does not list USDC on Monad");
  return match;
}

export type TopUpRequest = {
  /** Intents asset id the shopper pays with. */
  originAsset: string;
  /** Passkey wallet that receives USDC on Monad. */
  recipient: string;
  /** Where a failed swap refunds to, on the origin chain. */
  refundTo: string;
  /**
   * `exact-out`: deliver exactly `amount` atomic USDC (what an order is short).
   * `exact-in`: spend exactly `amount` of the origin asset.
   */
  mode: "exact-out" | "exact-in";
  amount: string;
  slippageBps?: number;
  /** true: price only, no deposit address. */
  dry?: boolean;
};

export async function quoteTopUp(req: TopUpRequest): Promise<IntentsQuoteResponse> {
  if (!isAddress(req.recipient)) throw new Error("Recipient must be an EVM address");
  if (!/^\d+$/.test(req.amount) || BigInt(req.amount) <= BigInt(0)) {
    throw new Error("Amount must be a positive integer in the smallest unit");
  }
  if (!req.refundTo.trim()) throw new Error("A refund address on the origin chain is required");
  const destination = await monadUsdcAsset();
  if (req.originAsset === destination.assetId) {
    throw new Error("That is already USDC on Monad. Send it to the wallet directly.");
  }
  return call<IntentsQuoteResponse>("/api/quote/{key}", {
    method: "POST",
    body: JSON.stringify({
      dry: Boolean(req.dry),
      swapType: req.mode === "exact-out" ? "EXACT_OUTPUT" : "EXACT_INPUT",
      depositType: "ORIGIN_CHAIN",
      originAsset: req.originAsset,
      destinationAsset: destination.assetId,
      amount: req.amount,
      slippageTolerance: Math.min(Math.max(req.slippageBps ?? 100, 10), 500),
      recipient: getAddress(req.recipient),
      recipientType: "DESTINATION_CHAIN",
      refundTo: req.refundTo.trim(),
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      quoteWaitingTimeMs: 3_000,
      connectedWallets: [getAddress(req.recipient)],
    }),
  });
}

export async function topUpStatus(depositAddress: string, depositMemo?: string) {
  const params = new URLSearchParams({ depositAddress });
  if (depositMemo) params.set("depositMemo", depositMemo);
  return call<IntentsStatusResponse>(`/api/status/{key}?${params.toString()}`);
}

/** Optional: tell the solver network about the deposit tx so it is picked up sooner. */
export async function submitTopUpDeposit(txHash: string, depositAddress: string, memo?: string) {
  return call<IntentsStatusResponse>("/api/deposit/submit/{key}", {
    method: "POST",
    body: JSON.stringify({ txHash, depositAddress, ...(memo ? { memo } : {}) }),
  });
}
