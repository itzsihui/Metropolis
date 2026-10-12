import { chainSettings, config, settleAssetFor } from "@/lib/config";
import type { StoreRecord } from "@/lib/store/types";

/** Chains and tokens a store accepts for x402, primary chain first. */
export function settlementNetworks() {
  return config.settleNetworks.flatMap((network) => {
    const chain = chainSettings(network);
    const settle = settleAssetFor(network, {});
    if (!settle) return [];
    return [
      {
        network,
        chainId: chain.chainId,
        name: chain.label,
        testnet: chain.isTestnet,
        asset: settle.asset,
        symbol: settle.symbol,
        decimals: config.tokenDecimals,
        payTo: chain.checkoutAddress || undefined,
        explorer: chain.explorerBase,
      },
    ];
  });
}

/** AI-readable store business card for agent discovery. */
export function renderAgentCard(store: StoreRecord, origin: string) {
  const base = `${origin}/s/${store.slug}`;
  return {
    name: store.name,
    slug: store.slug,
    protocol: "borneo-agentic-storefront",
    version: "1.0",
    protocols: ["llms.txt", "acp", "x402", "visa-card"],
    description:
      "AI-native storefront. Agents discover inventory and pay without a human checkout UI.",
    currency: {
      symbol: config.tokenSymbol,
      decimals: config.tokenDecimals,
      asset: config.tokenAddress,
      network: config.network,
    },
    /** Every chain this store settles on. `currency` above is the first one. */
    networks: settlementNetworks(),
    payTo: store.merchantAddress,
    endpoints: {
      llmsTxt: `${base}/llms.txt`,
      agentCard: `${base}/agent.json`,
      catalog: `${base}/catalog.json`,
      reviews: `${base}/reviews.json`,
      buyX402: `${base}/buy`,
      checkoutVisa: `${base}/checkout`,
      orders: `${base}/orders/{orderId}`,
    },
    skus: store.skus.map((sku) => ({
      id: sku.id,
      title: sku.title,
      quantity: sku.quantity,
      price: sku.price,
    })),
    createdAt: store.createdAt,
  };
}
