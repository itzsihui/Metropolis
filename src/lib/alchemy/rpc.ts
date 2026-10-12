/**
 * Alchemy node endpoints for the settlement chains. When ALCHEMY_API_KEY is
 * set (server only), every read, x402 settlement and relayer transaction on
 * these chains goes through Alchemy instead of the rate-limited public RPCs.
 * An explicit RPC_URL / RPC_URL_<chainId> still wins.
 */
const ALCHEMY_NETWORKS: Record<number, string> = {
  10143: "monad-testnet",
  143: "monad-mainnet",
  421614: "arb-sepolia",
  42161: "arb-mainnet",
  84532: "base-sepolia",
  8453: "base-mainnet",
};

export function alchemyNetwork(chainId: number): string | undefined {
  return ALCHEMY_NETWORKS[chainId];
}

export function alchemyRpcUrl(chainId: number): string | undefined {
  const key = typeof process !== "undefined" ? process.env.ALCHEMY_API_KEY?.trim() : undefined;
  const slug = ALCHEMY_NETWORKS[chainId];
  return key && slug ? `https://${slug}.g.alchemy.com/v2/${key}` : undefined;
}

/** For logs and UI: which provider an RPC URL belongs to, without the key. */
export function rpcProviderLabel(url: string): string {
  if (url.includes(".g.alchemy.com/")) return "Alchemy";
  try {
    return new URL(url).host;
  } catch {
    return "custom";
  }
}
