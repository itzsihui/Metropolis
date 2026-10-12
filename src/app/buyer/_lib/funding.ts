import type { FundingNeeded } from "@/lib/agents/tools-buyer";

/** Link to the any-chain top-up page, prefilled with what the order is short. */
export function fundingHref(funding: FundingNeeded, returnTo = "/buyer?resume=1") {
  const params = new URLSearchParams({
    need: funding.shortfallAtomic,
    network: funding.network,
    asset: funding.asset,
    symbol: funding.symbol,
    return: returnTo,
  });
  return `/buyer/fund?${params.toString()}`;
}
