import { arrivalsFor } from "@/lib/alchemy/webhooks";

export const runtime = "nodejs";

/** Transfers Alchemy has pushed for a wallet (optionally since an ISO time). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim() ?? "";
  const since = url.searchParams.get("since")?.trim() || undefined;
  return Response.json({ arrivals: arrivalsFor(address, since) });
}
