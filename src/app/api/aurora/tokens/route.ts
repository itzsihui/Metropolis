import {
  EVM_BLOCKCHAINS,
  intentsConfigured,
  listIntentsTokens,
  monadUsdcAsset,
} from "@/lib/aurora/intents";

export const runtime = "nodejs";

/** What a shopper can top up with, grouped by chain, plus the Monad USDC target. */
export async function GET() {
  if (!intentsConfigured()) {
    return Response.json(
      { configured: false, error: "Set AURORA_INTENTS_API_KEY to enable any-chain top-ups" },
      { status: 503 },
    );
  }
  try {
    const [tokens, destination] = await Promise.all([listIntentsTokens(), monadUsdcAsset()]);
    const origins = tokens
      .filter((t) => t.assetId !== destination.assetId)
      .map((t) => ({
        assetId: t.assetId,
        blockchain: t.blockchain,
        symbol: t.symbol,
        decimals: t.decimals,
        price: t.price,
        evm: EVM_BLOCKCHAINS.has(t.blockchain),
      }))
      .sort((a, b) => a.blockchain.localeCompare(b.blockchain) || a.symbol.localeCompare(b.symbol));
    return Response.json({
      configured: true,
      destination: {
        assetId: destination.assetId,
        symbol: destination.symbol,
        decimals: destination.decimals,
        blockchain: destination.blockchain,
      },
      origins,
    });
  } catch (error) {
    return Response.json(
      { configured: true, error: error instanceof Error ? error.message : "Token list failed" },
      { status: 502 },
    );
  }
}
