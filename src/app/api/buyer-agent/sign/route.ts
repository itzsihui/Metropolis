import { isHex } from "viem";
import { submitX402Signature, type PendingX402 } from "@/lib/agents/tools-buyer";
import { config } from "@/lib/config";

export const runtime = "nodejs";

/**
 * Second half of a passkey-wallet purchase: the browser signed the
 * authorization from /api/buyer-agent, this relays it to the store.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      pending?: PendingX402;
      signature?: string;
    };
    if (!body.pending || !body.signature || !isHex(body.signature)) {
      return Response.json(
        { steps: [{ type: "error", text: "pending and signature are required" }] },
        { status: 400 },
      );
    }
    const origin = config.protocolBaseUrl || new URL(request.url).origin;
    const result = await submitX402Signature({
      origin,
      pending: body.pending,
      signature: body.signature,
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signature submit failed";
    return Response.json(
      { steps: [{ type: "error", text: message }], error: message },
      { status: 500 },
    );
  }
}
