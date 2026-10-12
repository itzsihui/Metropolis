import { topUpStatus } from "@/lib/aurora/intents";

export const runtime = "nodejs";

/** Poll a top-up by its deposit address until SUCCESS, REFUNDED or FAILED. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const depositAddress = url.searchParams.get("depositAddress")?.trim();
  if (!depositAddress) {
    return Response.json({ error: "depositAddress is required" }, { status: 400 });
  }
  try {
    const status = await topUpStatus(
      depositAddress,
      url.searchParams.get("depositMemo")?.trim() || undefined,
    );
    return Response.json(status);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Status failed" },
      { status: 502 },
    );
  }
}
