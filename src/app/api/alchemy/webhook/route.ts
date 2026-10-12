import { parseArrivals, recordArrivals, verifyAlchemySignature } from "@/lib/alchemy/webhooks";
import { emit } from "@/lib/protocol/events";

export const runtime = "nodejs";

/** Alchemy Address Activity webhook receiver. Signature-checked on the raw body. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyAlchemySignature(raw, request.headers.get("x-alchemy-signature"))) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  let payload: Parameters<typeof parseArrivals>[0];
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const arrivals = parseArrivals(payload);
  recordArrivals(arrivals);
  for (const a of arrivals) {
    emit({
      status: 200,
      method: "POST",
      path: "/api/alchemy/webhook",
      message: `alchemy: ${a.value} ${a.asset} arrived at ${a.address.slice(0, 8)}… (${a.network})`,
    });
  }
  return Response.json({ ok: true, arrivals: arrivals.length });
}
