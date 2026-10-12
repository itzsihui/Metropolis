import { isAddress } from "viem";
import { runBuyerAgent } from "@/lib/agents/buyer";
import { config } from "@/lib/config";

export const runtime = "nodejs";

type BuyerAgentBody = {
  message?: string;
  buyerUid?: string;
  /** Passkey wallet address. The reply then carries `pending` to sign. */
  buyerAddress?: string;
  quote?: {
    storeSlug?: string;
    skuId?: string;
    price?: string;
    merchantAddress?: string;
    settleAsset?: string;
    settleSymbol?: string;
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BuyerAgentBody;
    const origin = config.protocolBaseUrl || new URL(request.url).origin;

    const quote =
      body.quote?.storeSlug && body.quote?.skuId && body.quote?.price
        ? {
            storeSlug: String(body.quote.storeSlug),
            skuId: String(body.quote.skuId),
            price: String(body.quote.price),
            merchantAddress: body.quote.merchantAddress
              ? (String(body.quote.merchantAddress) as string)
              : undefined,
            settleAsset: body.quote.settleAsset
              ? String(body.quote.settleAsset)
              : undefined,
            settleSymbol: body.quote.settleSymbol
              ? String(body.quote.settleSymbol)
              : undefined,
          }
        : undefined;

    const result = await runBuyerAgent({
      origin,
      message: body.message,
      quote,
      buyerUid: body.buyerUid?.trim() || undefined,
      buyerAddress:
        body.buyerAddress && isAddress(body.buyerAddress.trim())
          ? body.buyerAddress.trim()
          : undefined,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buyer agent failed";
    return Response.json(
      { steps: [{ type: "error", text: message }], error: message },
      { status: 500 },
    );
  }
}
