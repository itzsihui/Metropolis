import {
  CHAINS,
  DEFAULT_NETWORK,
  USDG_EIP712,
  chainPreset,
  isSupportedNetwork,
  normalizeNetwork,
  type ChainPreset,
} from "@/lib/chains";

export {
  USDC_ARBITRUM_ONE,
  USDC_ARBITRUM_SEPOLIA,
  USDG_ARBITRUM_ONE,
  USDG_ARBITRUM_SEPOLIA,
} from "@/lib/chains";

/** CAIP-2 id of a supported settlement chain (see lib/chains.ts). */
export type ChainNetwork = string;

/** @deprecated Use CHAINS from lib/chains. */
export const CHAIN_PRESETS: Record<ChainNetwork, ChainPreset> = CHAINS;

function env(name: string, fallback: string) {
  return process.env[name] || fallback;
}

/**
 * Receipts are read by agents outside the site, so an explorer base that is a
 * path on this site needs an origin: SITE_URL, else Vercel's production domain.
 * Stays relative when neither is set (local dev, client bundle).
 */
function absoluteExplorerBase(base: string) {
  if (!base.startsWith("/")) return base;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const origin =
    process.env.SITE_URL?.trim() || (vercel ? `https://${vercel}` : "");
  return `${origin.replace(/\/$/, "")}${base}`;
}

function resolveNetwork(): ChainNetwork {
  return (
    normalizeNetwork(
      process.env.CHAIN_NETWORK || process.env.NEXT_PUBLIC_CHAIN_NETWORK,
    ) ?? DEFAULT_NETWORK
  );
}

const network = resolveNetwork();
const preset = chainPreset(network);

/**
 * Extra chains a store also accepts payment on, from SETTLE_NETWORKS
 * (comma-separated: `base-sepolia, eip155:998, 11155111`). The primary
 * CHAIN_NETWORK always comes first. Unknown entries are ignored.
 */
function resolveSettleNetworks(): ChainNetwork[] {
  const raw =
    process.env.SETTLE_NETWORKS || process.env.NEXT_PUBLIC_SETTLE_NETWORKS || "";
  const out: ChainNetwork[] = [network];
  for (const part of raw.split(",")) {
    const id = normalizeNetwork(part);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function normalizePrivateKey(
  raw: string | undefined,
): `0x${string}` | undefined {
  const trimmed = raw?.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return undefined;
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  return hex as `0x${string}`;
}

export const config = {
  rpcUrl: env("RPC_URL", preset.rpcUrl),
  network,
  chainLabel: preset.label,
  nativeSymbol: preset.nativeSymbol,
  /** Numeric chain id of the primary settlement chain. */
  get chainId() {
    return Number(this.network.split(":")[1]);
  },
  get isTestnet() {
    return preset.testnet;
  },
  chainFamily: preset.family,
  /** Uniswap routing and the ETH gas bridge only exist for Arbitrum. */
  get isArbitrum() {
    return preset.family === "arbitrum";
  },
  /** Every chain stores accept payment on. Primary chain first. */
  get settleNetworks() {
    return resolveSettleNetworks();
  },
  /**
   * Chain the server-side buyer agent prefers to pay on (BUYER_NETWORK).
   * When unset it pays on the first accepted chain where it holds enough.
   */
  get buyerNetwork() {
    return normalizeNetwork(process.env.BUYER_NETWORK) ?? undefined;
  },
  tokenAddress: env("TOKEN_ADDRESS", preset.token),
  tokenSymbol: env("TOKEN_SYMBOL", preset.tokenSymbol),
  tokenDecimals: Number(env("TOKEN_DECIMALS", "6")),
  tokenEip712Name: env("TOKEN_EIP712_NAME", preset.tokenEip712Name),
  tokenEip712Version: env("TOKEN_EIP712_VERSION", preset.tokenEip712Version),
  /** Paxos USDG on the active chain (EIP-3009, domain "Global Dollar" / "1"). */
  usdgAddress: env("USDG_ADDRESS", preset.usdg),
  /**
   * Second settle asset for multi-asset SKUs. Defaults to Paxos USDG where it
   * is issued, otherwise the chain's default token. Set ALT_SETTLE_TOKEN to
   * any other EIP-3009 ERC-20 allowlisted on the checkout.
   */
  altSettleToken: env("ALT_SETTLE_TOKEN", preset.usdg || preset.token),
  altSettleSymbol: env(
    "ALT_SETTLE_SYMBOL",
    preset.usdg ? "USDG" : preset.tokenSymbol,
  ),
  /**
   * BorneoCheckout contract. When set, x402 payments are settled through it
   * (order-bound ReceiveWithAuthorization, on-chain fee split and XPoints).
   * When empty, payments go straight to the merchant via transferWithAuthorization.
   */
  checkoutAddress: (
    process.env[`CHECKOUT_ADDRESS_${preset.chainId}`] ||
    env("CHECKOUT_ADDRESS", "")
  ).trim(),
  /**
   * Uniswap has no real liquidity on testnets. When settling on one, show a
   * live quote from Arbitrum One instead. Quote only: swaps are never
   * broadcast from a mainnet preview. Set DEX_MAINNET_PREVIEW=0 to disable.
   */
  get dexMainnetPreview() {
    return this.isTestnet && process.env.DEX_MAINNET_PREVIEW !== "0";
  },
  /**
   * Relayer that submits the settlement transaction (pays gas in the chain's
   * native token). Falls back to the buyer key so one funded wallet can demo.
   */
  get facilitatorPrivateKey() {
    return (
      normalizePrivateKey(process.env.FACILITATOR_PRIVATE_KEY) ||
      this.buyerPrivateKey
    );
  },
  /** Demo unit price in the settle stablecoin. */
  demoUnitPriceXsgd: "0.01",
  merchantAddress: env(
    "MERCHANT_ADDRESS",
    "0x0000000000000000000000000000000000000001",
  ),
  /** Buyer EVM private key for server-side x402 settle. */
  get buyerPrivateKey() {
    return normalizePrivateKey(process.env.BUYER_PRIVATE_KEY);
  },
  /** @deprecated Alias — prefer buyerPrivateKey. */
  get buyerSeed() {
    return this.buyerPrivateKey;
  },
  explorerBase: absoluteExplorerBase(env("EXPLORER_BASE", preset.explorerBase)),
  /** Optional legacy Card MCP URL — unused when empty; Visa rail uses local mandate. */
  straitsxMcpUrl: env("STRAITSX_MCP_URL", ""),
  get straitsxMcpToken() {
    return (
      process.env.STRAITSX_MCP_TOKEN?.trim() ||
      process.env.STRAITSX_API_KEY?.trim() ||
      undefined
    );
  },
  bedrockRegion: env("AWS_REGION", "ap-southeast-1"),
  bedrockModel: env(
    "BEDROCK_MODEL_ID",
    "anthropic.claude-3-haiku-20240307-v1:0",
  ),
  /** When set, buyer/card agents hit API Gateway instead of the Next origin. */
  get protocolBaseUrl() {
    return (
      process.env.PROTOCOL_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_PROTOCOL_BASE_URL?.trim() ||
      undefined
    );
  },
  /**
   * Protocol micro-fee in basis points (app-layer XPoints accrual).
   * Merchant still receives the full listed amount via x402.
   */
  protocolFeeBps: Number(env("PROTOCOL_FEE_BPS", "50")),
  /** Optional treasury address for fee narrative / future on-chain splits. */
  treasuryAddress: env(
    "TREASURY_ADDRESS",
    "0x00000000000000000000000000000000000000fe",
  ),
};

/** Everything needed to settle on one chain. */
export type ChainSettings = {
  network: ChainNetwork;
  chainId: number;
  label: string;
  family: ChainPreset["family"];
  isTestnet: boolean;
  rpcUrl: string;
  explorerBase: string;
  nativeSymbol: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenEip712Name: string;
  tokenEip712Version: string;
  usdgAddress: string;
  /** BorneoCheckout on this chain, or "" to pay merchants directly. */
  checkoutAddress: string;
};

/**
 * Settings for any supported chain. The primary chain honours the legacy
 * un-suffixed overrides (RPC_URL, TOKEN_ADDRESS, CHECKOUT_ADDRESS, ...).
 * Other chains use their preset plus `RPC_URL_<chainId>`,
 * `EXPLORER_BASE_<chainId>` and `CHECKOUT_ADDRESS_<chainId>`.
 */
export function chainSettings(target: ChainNetwork = config.network): ChainSettings {
  if (target === config.network) {
    return {
      network: config.network,
      chainId: config.chainId,
      label: config.chainLabel,
      family: preset.family,
      isTestnet: config.isTestnet,
      rpcUrl: config.rpcUrl,
      explorerBase: config.explorerBase,
      nativeSymbol: config.nativeSymbol,
      tokenAddress: config.tokenAddress,
      tokenSymbol: config.tokenSymbol,
      tokenEip712Name: config.tokenEip712Name,
      tokenEip712Version: config.tokenEip712Version,
      usdgAddress: config.usdgAddress,
      checkoutAddress: config.checkoutAddress,
    };
  }
  const p = chainPreset(target);
  return {
    network: p.network,
    chainId: p.chainId,
    label: p.label,
    family: p.family,
    isTestnet: p.testnet,
    rpcUrl: env(`RPC_URL_${p.chainId}`, p.rpcUrl),
    explorerBase: absoluteExplorerBase(
      env(`EXPLORER_BASE_${p.chainId}`, p.explorerBase),
    ),
    nativeSymbol: p.nativeSymbol,
    tokenAddress: p.token,
    tokenSymbol: p.tokenSymbol,
    tokenEip712Name: p.tokenEip712Name,
    tokenEip712Version: p.tokenEip712Version,
    usdgAddress: p.usdg,
    checkoutAddress: (process.env[`CHECKOUT_ADDRESS_${p.chainId}`] || "").trim(),
  };
}

/**
 * Human list of the chains stores settle on, for UI copy:
 * "Arbitrum Sepolia", "Arbitrum Sepolia and Base Sepolia",
 * "Arbitrum Sepolia, Base Sepolia and 2 more".
 */
export function settleChainsLabel() {
  const labels = config.settleNetworks.map((n) => chainSettings(n).label);
  if (labels.length <= 1) return labels[0] ?? config.chainLabel;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`;
}

/** Chain label for a CAIP-2 id, falling back to the id itself. */
export function chainLabelFor(target: string | undefined) {
  if (!target) return config.chainLabel;
  return isSupportedNetwork(target) ? chainSettings(target).label : target;
}

const sameAddress = (a: string, b: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which token a SKU settles in on a given chain, or null when the SKU's asset
 * does not exist there (that chain is then left out of the 402 for that SKU).
 * All supported settle tokens are 6-decimal dollar stablecoins, so the listed
 * price carries over 1:1.
 */
export function settleAssetFor(
  target: ChainNetwork,
  sku: { settleAsset?: string; settleSymbol?: string },
): { asset: string; symbol: string } | null {
  const chain = chainSettings(target);
  const primary = chainSettings(config.network);
  const skuAsset = sku.settleAsset?.trim() || "";
  const wantsDefault = !skuAsset || sameAddress(skuAsset, primary.tokenAddress);

  if (target === config.network) {
    if (wantsDefault) {
      return { asset: chain.tokenAddress, symbol: chain.tokenSymbol };
    }
    return {
      asset: skuAsset,
      symbol: (sku.settleSymbol || chain.tokenSymbol).trim(),
    };
  }
  if (wantsDefault) {
    return { asset: chain.tokenAddress, symbol: chain.tokenSymbol };
  }
  const wantsUsdg =
    sameAddress(skuAsset, primary.usdgAddress) ||
    sku.settleSymbol?.trim().toUpperCase() === "USDG";
  if (wantsUsdg && chain.usdgAddress) {
    return { asset: chain.usdgAddress, symbol: "USDG" };
  }
  return null;
}

/** EIP-712 domain name/version for an EIP-3009 settle token. */
export function eip712DomainFor(
  asset: string,
  symbol: string,
  target: ChainNetwork = config.network,
) {
  const chain = chainSettings(target);
  if (sameAddress(asset, chain.tokenAddress)) {
    return { name: chain.tokenEip712Name, version: chain.tokenEip712Version };
  }
  if (sameAddress(asset, chain.usdgAddress)) {
    return { ...USDG_EIP712 };
  }
  return { name: symbol, version: "1" };
}

function explorerBaseFor(target?: ChainNetwork) {
  const base =
    target && isSupportedNetwork(target)
      ? chainSettings(target).explorerBase
      : config.explorerBase;
  return base.replace(/\/$/, "");
}

export function explorerAddress(address: string, target?: ChainNetwork) {
  return `${explorerBaseFor(target)}/address/${address}`;
}

export function explorerTx(hash: string, target?: ChainNetwork) {
  return `${explorerBaseFor(target)}/tx/${hash}`;
}

/** Decimal stablecoin amount string for display / locked quotes. */
export function toPaymentAmount(price: string, quantity = 1) {
  const n = Number(price) * quantity;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }
  return n.toFixed(config.tokenDecimals).replace(/\.?0+$/, "") || n.toFixed(2);
}

/** Integer micro-units for x402 `amount` and order storage. */
export function toAtomic(price: string) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }
  return BigInt(Math.round(n * 10 ** config.tokenDecimals)).toString();
}

export function fromAtomic(atomic: string) {
  if (atomic.includes(".")) {
    return Number(atomic).toFixed(2);
  }
  const v = Number(atomic) / 10 ** config.tokenDecimals;
  return v.toFixed(2);
}
