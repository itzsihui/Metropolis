/**
 * Check the chain presets against the live chains before you settle on them.
 *   npx tsx --env-file=.env scripts/check-chains.mts [network ...]
 *
 * With no arguments it checks CHAIN_NETWORK plus SETTLE_NETWORKS. Pass `all`
 * for every supported chain, or name chains (`base-sepolia`, `eip155:998`).
 * For each chain it confirms:
 *   - the RPC answers with the expected chain id
 *   - the settle token has 6 decimals and speaks EIP-3009
 *   - the EIP-712 domain Borneo signs with matches the token's DOMAIN_SEPARATOR
 *   - the configured BorneoCheckout exists and allowlists the settle token
 *   - the relayer wallet holds gas
 * Exits non-zero if any chain fails, so it can gate a deploy.
 */
import { createPublicClient, formatEther, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainPreset, listChains, normalizeNetwork } from "../src/lib/chains.ts";
import { rpcProviderLabel } from "../src/lib/alchemy/rpc.ts";
import { chainSettings, config, eip712DomainFor } from "../src/lib/config.ts";
import { matchDomain, resolveTokenDomain } from "../src/lib/protocol/token-domain.ts";

const abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowedToken",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const ZERO_NONCE = `0x${"00".repeat(32)}` as Hex;

function targets(args: string[]): string[] {
  if (args.length === 0) return config.settleNetworks;
  if (args.includes("all")) return listChains().map((c) => c.network);
  return args.map((arg) => {
    const network = normalizeNetwork(arg);
    if (!network) throw new Error(`unknown network: ${arg}`);
    return network;
  });
}

async function checkChain(network: string): Promise<boolean> {
  const chain = chainSettings(network);
  const client = createPublicClient({
    chain: chainPreset(network).viemChain,
    transport: http(chain.rpcUrl, { timeout: 10_000 }),
  });
  let ok = true;
  const line = (pass: boolean | null, text: string) => {
    if (pass === false) ok = false;
    console.log(`  ${pass === null ? "--" : pass ? "ok" : "FAIL"}  ${text}`);
  };

  console.log(`\n${chain.label} (${network})`);
  try {
    const id = await client.getChainId();
    line(id === chain.chainId, `rpc ${rpcProviderLabel(chain.rpcUrl)} reports chain ${id}`);
    if (id !== chain.chainId) return false;
  } catch (error) {
    line(false, `rpc ${rpcProviderLabel(chain.rpcUrl)} unreachable: ${(error as Error).message.split("\n")[0]}`);
    return false;
  }

  const token = getAddress(chain.tokenAddress);
  const read = <T,>(call: Promise<T>) => call.catch(() => null);
  const [decimals, symbol, separator, eip3009] = await Promise.all([
    read(client.readContract({ address: token, abi, functionName: "decimals" })),
    read(client.readContract({ address: token, abi, functionName: "symbol" })),
    read(client.readContract({ address: token, abi, functionName: "DOMAIN_SEPARATOR" })),
    read(client.readContract({ address: token, abi, functionName: "authorizationState", args: [token, ZERO_NONCE] })),
  ]);
  line(decimals === config.tokenDecimals, `${chain.tokenSymbol} ${token}: on-chain symbol ${symbol ?? "?"}, decimals ${decimals ?? "?"}`);
  line(eip3009 !== null, "token answers authorizationState (EIP-3009)");

  const presetDomain = eip712DomainFor(token, chain.tokenSymbol, network);
  const resolved = await resolveTokenDomain(network, token, chain.tokenSymbol);
  const confirmed = matchDomain([resolved], separator, chain.chainId, token);
  line(
    confirmed !== null,
    `EIP-712 domain "${resolved.name}" / "${resolved.version}" ${confirmed ? "matches" : "does NOT match"} DOMAIN_SEPARATOR`,
  );
  if (resolved.name !== presetDomain.name || resolved.version !== presetDomain.version) {
    line(null, `preset says "${presetDomain.name}" / "${presetDomain.version}": update src/lib/chains.ts`);
  }

  if (chain.checkoutAddress) {
    const checkout = getAddress(chain.checkoutAddress);
    const code = await read(client.getCode({ address: checkout }));
    const deployed = !!code && code !== "0x";
    line(deployed, `BorneoCheckout ${checkout} ${deployed ? "has code" : "has NO code on this chain"}`);
    if (deployed) {
      const allowed = await read(
        client.readContract({ address: checkout, abi, functionName: "allowedToken", args: [token] }),
      );
      line(allowed === true, `checkout allowlists ${chain.tokenSymbol}`);
    }
  } else {
    line(null, `no CHECKOUT_ADDRESS_${chain.chainId}: payments go straight to the merchant`);
  }

  const relayerKey = config.facilitatorPrivateKey;
  if (relayerKey) {
    const relayer = privateKeyToAccount(relayerKey).address;
    const gas = await read(client.getBalance({ address: relayer }));
    line(gas !== null && gas > 0n, `relayer ${relayer} holds ${gas === null ? "?" : formatEther(gas)} ${chain.nativeSymbol}`);
  } else {
    line(null, "no FACILITATOR_PRIVATE_KEY / BUYER_PRIVATE_KEY: relayer gas not checked");
  }
  return ok;
}

const results: boolean[] = [];
for (const network of targets(process.argv.slice(2))) {
  results.push(await checkChain(network));
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} chains ready`);
if (failed) process.exit(1);
