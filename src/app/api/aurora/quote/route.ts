import { quoteTopUp, type TopUpRequest } from "@/lib/aurora/intents";
import { emit } from "@/lib/protocol/events";

export const runtime = "nodejs";

/**
 * Quote a top-up into the shopper's passkey wallet on Monad. With
 * `dry: false` the reply carries a one-time deposit address on the origin
 * chain; funds sent there arrive as USDC on Monad.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<TopUpRequest>;
    const quote = await quoteTopUp({
      originAsset: String(body.originAsset || ""),
      recipient: String(body.recipient || ""),
      refundTo: String(body.refundTo || ""),
      mode: body.mode === "exact-in" ? "exact-in" : "exact-out",
      amount: String(body.amount || ""),
      slippageBps: Number(body.slippageBps) || undefined,
      dry: body.dry !== false,
    });
    if (quote.quote.depositAddress) {
      emit({
        status: 200,
        method: "POST",
        path: "/api/aurora/quote",
        message: `top-up quote · ${quote.quote.amountInFormatted} → ${quote.quote.amountOutFormatted} USDC on Monad`,
      });
    }
    return Response.json(quote);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Quote failed" },
      { status: 400 },
    );
  }
}
