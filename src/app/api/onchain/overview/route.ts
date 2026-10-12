import { indexConfigured, protocolOverview } from "@/lib/envio/checkout-index";

export const runtime = "nodejs";

/** Protocol totals per checkout and daily volume, from the Envio index. */
export async function GET() {
  if (!indexConfigured()) {
    return Response.json({ configured: false }, { status: 200 });
  }
  try {
    return Response.json({ configured: true, ...(await protocolOverview()) });
  } catch (error) {
    return Response.json(
      { configured: true, error: error instanceof Error ? error.message : "Index query failed" },
      { status: 502 },
    );
  }
}
