import {
  createPublicClient,
  domainSeparator,
  getAddress,
  http,
  type Hex,
} from "viem";
import { chainPreset } from "@/lib/chains";
import { chainSettings, eip712DomainFor } from "@/lib/config";

/**
 * EIP-712 domain of a settle token, checked against the chain.
 *
 * An EIP-3009 signature only verifies if `name` and `version` match what the
 * token contract hashes into its DOMAIN_SEPARATOR, and those strings differ
 * between deployments of the same stablecoin ("USD Coin" vs "USDC"). So rather
 * than trusting a preset on every chain, read the candidates from the token
 * and keep the one whose separator matches. Falls back to the preset when the
 * RPC is unreachable, so a slow node never blocks a 402.
 */
export type TokenDomain = { name: string; version: string };

const domainAbi = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const LOOKUP_TIMEOUT_MS = 3_000;
/** How long an unconfirmed answer is reused before the chain is asked again. */
const UNCONFIRMED_TTL_MS = 60_000;
const cache = new Map<string, TokenDomain>();
const unconfirmed = new Map<string, { domain: TokenDomain; until: number }>();

/** Pick the candidate whose EIP-712 separator equals the token's on-chain one. */
export function matchDomain(
  candidates: TokenDomain[],
  onchainSeparator: Hex | null,
  chainId: number,
  asset: string,
): TokenDomain | null {
  if (!onchainSeparator) return null;
  const verifyingContract = getAddress(asset);
  for (const candidate of candidates) {
    const computed = domainSeparator({
      domain: { ...candidate, chainId, verifyingContract },
    });
    if (computed.toLowerCase() === onchainSeparator.toLowerCase()) {
      return candidate;
    }
  }
  return null;
}

async function readOnchain(network: string, asset: string) {
  const chain = chainSettings(network);
  const client = createPublicClient({
    chain: chainPreset(network).viemChain,
    transport: http(chain.rpcUrl, { timeout: LOOKUP_TIMEOUT_MS, retryCount: 0 }),
  });
  const address = getAddress(asset);
  const read = <T>(call: Promise<T>) => call.catch(() => null);
  const [eip5267, name, version, separator] = await Promise.all([
    read(client.readContract({ address, abi: domainAbi, functionName: "eip712Domain" })),
    read(client.readContract({ address, abi: domainAbi, functionName: "name" })),
    read(client.readContract({ address, abi: domainAbi, functionName: "version" })),
    read(client.readContract({ address, abi: domainAbi, functionName: "DOMAIN_SEPARATOR" })),
  ]);
  const candidates: TokenDomain[] = [];
  if (eip5267) candidates.push({ name: eip5267[1], version: eip5267[2] });
  if (name && version) candidates.push({ name, version });
  return { candidates, separator };
}

/**
 * Resolve the signing domain for `asset` on `network`. The result is cached
 * for the life of the process once it has been confirmed on-chain.
 */
export async function resolveTokenDomain(
  network: string,
  asset: string,
  symbol: string,
): Promise<TokenDomain> {
  const fallback = eip712DomainFor(asset, symbol, network);
  const key = `${network}:${asset.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const recent = unconfirmed.get(key);
  if (recent && recent.until > Date.now()) return recent.domain;
  let domain = fallback;
  try {
    const { candidates, separator } = await readOnchain(network, asset);
    const confirmed = matchDomain(
      [fallback, ...candidates],
      separator,
      chainSettings(network).chainId,
      asset,
    );
    if (confirmed) {
      cache.set(key, confirmed);
      return confirmed;
    }
    // No separator to check against: trust what the token reports about itself.
    if (!separator && candidates[0]) domain = candidates[0];
  } catch {
    // Unreachable RPC or a non-standard token: use the preset.
  }
  unconfirmed.set(key, { domain, until: Date.now() + UNCONFIRMED_TTL_MS });
  return domain;
}
