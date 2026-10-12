import { getAddress, isAddress } from "viem";
import { chainSettings, config } from "@/lib/config";
import { isSupportedNetwork } from "@/lib/chains";
import { readTokenBalance } from "@/lib/protocol/x402-evm";

export const runtime = "nodejs";

/** Settle-token balance of any wallet on a settlement chain (default: primary). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim() ?? "";
  const network = url.searchParams.get("network")?.trim() || config.network;
  if (!isAddress(address) || !isSupportedNetwork(network)) {
    return Response.json({ error: "address and a supported network are required" }, { status: 400 });
  }
  const chain = chainSettings(network);
  const asset = url.searchParams.get("asset")?.trim() || chain.tokenAddress;
  if (!isAddress(asset)) {
    return Response.json({ error: "invalid asset" }, { status: 400 });
  }
  try {
    const balance = await readTokenBalance({
      network,
      rpcUrl: chain.rpcUrl,
      asset,
      owner: getAddress(address),
    });
    return Response.json({
      address: getAddress(address),
      network,
      chainLabel: chain.label,
      asset,
      balanceAtomic: balance.toString(),
      balance: (Number(balance) / 10 ** config.tokenDecimals).toString(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Balance read failed" },
      { status: 502 },
    );
  }
}
