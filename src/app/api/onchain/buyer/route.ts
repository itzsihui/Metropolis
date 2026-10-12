import { indexConfigured, buyerHistory } from "@/lib/envio/checkout-index";

export const runtime = "nodejs";

/** On-chain order history and XPoints for a buyer wallet, from the Envio index. */
export async function GET(request: Request) {
  if (!indexConfigured()) {
    return Response.json({ configured: false }, { status: 200 });
  }
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  try {
    return Response.json({ configured: true, ...(await buyerHistory(address)) });
  } catch (error) {
    return Response.json(
      { configured: true, error: error instanceof Error ? error.message : "Index query failed" },
      { status: 502 },
    );
  }
}
