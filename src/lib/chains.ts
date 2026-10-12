import type { Chain } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  hyperEvm,
  hyperliquidEvmTestnet,
} from "viem/chains";

/**
 * Settlement chains Borneo runs on: Arbitrum, Base and HyperEVM, each with a
 * testnet and a mainnet. All three have Circle-native USDC with EIP-3009, so
 * the same x402 `exact` flow and the same BorneoCheckout contract work
 * unchanged on each of them.
 *
 * Token addresses come from the issuers' own docs:
 *   USDC: https://developers.circle.com/stablecoins/usdc-contract-addresses
 *   USDG: https://docs.paxos.com/guides/stablecoin/usdg/mainnet (and /testnet)
 */
export type ChainFamily = "arbitrum" | "base" | "hyperliquid";

export type ChainPreset = {
  /** CAIP-2 id, e.g. `eip155:8453`. */
  network: string;
  chainId: number;
  viemChain: Chain;
  family: ChainFamily;
  label: string;
  testnet: boolean;
  rpcUrl: string;
  /** Absolute URL, or a path on this site (resolved against SITE_URL). */
  explorerBase: string;
  /** Gas token the relayer pays in. Buyers never need it. */
  nativeSymbol: string;
  /** Default settle stablecoin (EIP-3009, 6 decimals). */
  token: string;
  tokenSymbol: string;
  /**
   * EIP-712 domain of the settle token. Used as the fallback when the domain
   * cannot be read from the chain (see protocol/token-domain.ts).
   */
  tokenEip712Name: string;
  tokenEip712Version: string;
  /** Paxos USDG on this chain, or "" when it is not issued there. */
  usdg: string;
};

/** Circle USDC (EIP-3009) on Arbitrum Sepolia. */
export const USDC_ARBITRUM_SEPOLIA = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
/** Circle native USDC on Arbitrum One. */
export const USDC_ARBITRUM_ONE = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
/** Paxos Global Dollar (USDG, EIP-3009) on Arbitrum Sepolia. */
export const USDG_ARBITRUM_SEPOLIA = "0xFFC95faa3d63Cde504a05B567C600B78C0b41892";
/** Paxos Global Dollar (USDG, EIP-3009) on Arbitrum One. */
export const USDG_ARBITRUM_ONE = "0x004B506865409877C9fA29bfb1ebA929984B9bbC";

/** EIP-712 domain shared by every Paxos USDG deployment. */
export const USDG_EIP712 = { name: "Global Dollar", version: "1" } as const;

function preset(
  viemChain: Chain,
  family: ChainFamily,
  fields: Omit<
    ChainPreset,
    "network" | "chainId" | "viemChain" | "family" | "testnet" | "nativeSymbol"
  >,
): ChainPreset {
  return {
    network: `eip155:${viemChain.id}`,
    chainId: viemChain.id,
    viemChain,
    family,
    testnet: Boolean(viemChain.testnet),
    nativeSymbol: viemChain.nativeCurrency.symbol,
    ...fields,
  };
}

const usdc = (token: string, tokenEip712Name: string) => ({
  token,
  tokenSymbol: "USDC",
  tokenEip712Name,
  tokenEip712Version: "2",
});

const PRESETS: ChainPreset[] = [
  // Arbitrum: where Borneo started, and where BorneoCheckout is deployed.
  preset(arbitrumSepolia, "arbitrum", {
    label: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerBase: "https://sepolia.arbiscan.io",
    ...usdc(USDC_ARBITRUM_SEPOLIA, "USD Coin"),
    usdg: USDG_ARBITRUM_SEPOLIA,
  }),
  preset(arbitrum, "arbitrum", {
    label: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerBase: "https://arbiscan.io",
    ...usdc(USDC_ARBITRUM_ONE, "USD Coin"),
    usdg: USDG_ARBITRUM_ONE,
  }),
  preset(baseSepolia, "base", {
    label: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    explorerBase: "https://sepolia.basescan.org",
    ...usdc("0x036CbD53842c5426634e7929541eC2318f3dCF7e", "USDC"),
    usdg: "",
  }),
  preset(base, "base", {
    label: "Base",
    rpcUrl: "https://mainnet.base.org",
    explorerBase: "https://basescan.org",
    ...usdc("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USD Coin"),
    usdg: "",
  }),
  // HyperEVM: Circle-native USDC. Gas is HYPE, paid by the relayer.
  preset(hyperliquidEvmTestnet, "hyperliquid", {
    label: "HyperEVM Testnet",
    rpcUrl: "https://rpc.hyperliquid-testnet.xyz/evm",
    // No public explorer indexes this testnet, so links go to Borneo's own
    // RPC-backed viewer (src/app/explorer). Override with EXPLORER_BASE_998.
    explorerBase: "/explorer/998",
    ...usdc("0x2B3370eE501B4a559b57D449569354196457D8Ab", "USDC"),
    usdg: "",
  }),
  preset(hyperEvm, "hyperliquid", {
    label: "HyperEVM",
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    explorerBase: "https://hyperevmscan.io",
    ...usdc("0xb88339CB7199b77E23DB6E890353E22632Ba630f", "USDC"),
    usdg: "",
  }),
];

export const CHAINS: Record<string, ChainPreset> = Object.fromEntries(
  PRESETS.map((p) => [p.network, p]),
);

export const DEFAULT_NETWORK = "eip155:421614";

export function isSupportedNetwork(network: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHAINS, network);
}

export function chainPreset(network: string): ChainPreset {
  const found = CHAINS[network];
  if (!found) {
    throw new Error(
      `Unsupported network: ${network}. Supported: ${Object.keys(CHAINS).join(", ")}`,
    );
  }
  return found;
}

/** Accepts `eip155:8453`, `8453`, or a chain label such as `base`. */
export function normalizeNetwork(raw: string | undefined | null): string | null {
  const value = raw?.trim().replace(/^["']|["']$/g, "");
  if (!value) return null;
  if (isSupportedNetwork(value)) return value;
  if (/^\d+$/.test(value) && isSupportedNetwork(`eip155:${value}`)) {
    return `eip155:${value}`;
  }
  const wanted = value.toLowerCase().replace(/[\s_-]+/g, "");
  const byLabel = PRESETS.find(
    (p) => p.label.toLowerCase().replace(/[\s_-]+/g, "") === wanted,
  );
  return byLabel?.network ?? null;
}

export function listChains(): ChainPreset[] {
  return [...PRESETS];
}
