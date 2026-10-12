import type { Hex } from "viem";
import { authorizationTypedData } from "@/lib/protocol/x402-evm";
import type { FundingNeeded, PendingX402, BuyerReceipt } from "@/lib/agents/tools-buyer";
import type { SignOutcome } from "../_components/passkey-wallet-provider";
import type { ScopedTypedData } from "@/lib/mera/session-scope";

export type StablecoinQuote = {
  storeSlug: string;
  skuId: string;
  price: string;
  merchantAddress?: string;
  settleAsset?: string;
  settleSymbol?: string;
};

export type AgentStep = { type: string; text: string };

export type SettleResponse = {
  steps?: AgentStep[];
  error?: string;
  receipt?: BuyerReceipt & {
    explorerUrl?: string;
    orderId?: string;
    ownershipPoints?: number;
    grossAtomic?: string;
    feeAtomic?: string;
    swapExplorerUrl?: string;
    routeSummary?: string;
  };
  pending?: PendingX402;
  funding?: FundingNeeded;
};

type Signer = (typed: ScopedTypedData & Record<string, unknown>) => Promise<SignOutcome>;

async function postJson(url: string, body: unknown): Promise<SettleResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as SettleResponse;
}

/**
 * Pay one locked quote over x402. With a passkey wallet the server runs
 * discovery and the capability checks, the browser signs the EIP-3009
 * authorization (prompt-free inside the session scope), and the server relays
 * it. Without one, the server-side agent wallet pays as before.
 */
export async function settleStablecoinQuote(args: {
  quote: StablecoinQuote;
  buyerUid?: string;
  buyerAddress?: string | null;
  sign?: Signer;
}): Promise<SettleResponse> {
  const first = await postJson("/api/buyer-agent", {
    buyerUid: args.buyerUid,
    buyerAddress: args.buyerAddress || undefined,
    quote: args.quote,
  });
  if (!first.pending || !args.sign) return first;

  const typed = authorizationTypedData(first.pending.accept, first.pending.authorization);
  let outcome: SignOutcome;
  try {
    outcome = await args.sign(typed as unknown as ScopedTypedData & Record<string, unknown>);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Passkey signing cancelled";
    return {
      ...first,
      steps: [...(first.steps ?? []), { type: "error", text: reason }],
    };
  }
  const steps: AgentStep[] = [
    ...(first.steps ?? []),
    {
      type: "chain",
      text: outcome.prompted
        ? `Passkey asked again (${outcome.reason ?? "outside the session"}) and signed`
        : "Signed inside the passkey session: no prompt",
    },
  ];
  const second = await postJson("/api/buyer-agent/sign", {
    pending: first.pending,
    signature: outcome.signature as Hex,
  });
  return { ...second, steps: [...steps, ...(second.steps ?? [])] };
}
