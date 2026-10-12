import { submitTopUpDeposit } from "@/lib/aurora/intents";

export const runtime = "nodejs";

/** Optional speed-up: report the origin-chain deposit tx hash. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      txHash?: string;
      depositAddress?: string;
      memo?: string;
    };
    if (!body.txHash?.trim() || !body.depositAddress?.trim()) {
      return Response.json({ error: "txHash and depositAddress are required" }, { status: 400 });
    }
    const status = await submitTopUpDeposit(
      body.txHash.trim(),
      body.depositAddress.trim(),
      body.memo?.trim() || undefined,
    );
    return Response.json(status);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Submit failed" },
      { status: 502 },
    );
  }
}
