import { indexConfigured, merchantSales } from "@/lib/envio/checkout-index";

export const runtime = "nodejs";

/** On-chain sales and buyers for a merchant payout address, from the Envio index. */
export async function GET(request: Request) {
  if (!indexConfigured()) {
    return Response.json({ configured: false }, { status: 200 });
  }
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  try {
    return Response.json({ configured: true, ...(await merchantSales(address)) });
  } catch (error) {
    return Response.json(
      { configured: true, error: error instanceof Error ? error.message : "Index query failed" },
      { status: 502 },
    );
  }
}
