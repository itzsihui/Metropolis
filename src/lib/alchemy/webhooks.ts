import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { listChains } from "@/lib/chains";

/**
 * Alchemy Address Activity webhooks: Alchemy pushes every transfer into a
 * watched wallet. Borneo watches a shopper's passkey wallet the moment they
 * ask for a top-up, so USDC arriving from Aurora Intents shows up without
 * polling the chain.
 *
 * Env:
 *   ALCHEMY_WEBHOOK_SIGNING_KEY  per-webhook signing key (verifies pushes)
 *   ALCHEMY_WEBHOOK_ID           Address Activity webhook to add wallets to
 *   ALCHEMY_NOTIFY_TOKEN         auth token for the Notify API
 */
export type Arrival = {
  address: string;
  from: string;
  asset: string;
  value: string;
  token?: string;
  hash: string;
  network: string;
  at: string;
};

type ActivityItem = {
  fromAddress?: string;
  toAddress?: string;
  hash?: string;
  value?: number | string;
  asset?: string;
  category?: string;
  rawContract?: { address?: string; rawValue?: string; decimals?: number };
};

type AddressActivityPayload = {
  webhookId?: string;
  id?: string;
  createdAt?: string;
  type?: string;
  event?: { network?: string; activity?: ActivityItem[] };
};

/** Recent arrivals per wallet. In memory: one instance's view, fine as a fast path. */
const recent = new Map<string, Arrival[]>();
const MAX_PER_ADDRESS = 20;

export function verifyAlchemySignature(rawBody: string, signature: string | null): boolean {
  const key = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY?.trim();
  if (!key || !signature) return false;
  const expected = createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature.trim(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const knownTokens = () =>
  new Set(
    listChains()
      .flatMap((c) => [c.token, c.usdg])
      .filter(Boolean)
      .map((t) => t.toLowerCase()),
  );

/** Stablecoin transfers in an Address Activity push, newest last. */
export function parseArrivals(payload: AddressActivityPayload): Arrival[] {
  const tokens = knownTokens();
  const network = payload.event?.network ?? "unknown";
  const at = payload.createdAt ?? new Date().toISOString();
  return (payload.event?.activity ?? [])
    .filter((a) => a.toAddress && isAddress(a.toAddress) && a.hash)
    .filter((a) => {
      const token = a.rawContract?.address?.toLowerCase();
      return a.category === "token" ? Boolean(token && tokens.has(token)) : a.category === "external";
    })
    .map((a) => ({
      address: getAddress(a.toAddress!).toLowerCase(),
      from: a.fromAddress ?? "",
      asset: a.asset ?? "",
      value: String(a.value ?? ""),
      token: a.rawContract?.address?.toLowerCase(),
      hash: a.hash!,
      network,
      at,
    }));
}

export function recordArrivals(arrivals: Arrival[]) {
  for (const arrival of arrivals) {
    const list = recent.get(arrival.address) ?? [];
    if (list.some((x) => x.hash === arrival.hash && x.token === arrival.token)) continue;
    list.push(arrival);
    recent.set(arrival.address, list.slice(-MAX_PER_ADDRESS));
  }
}

export function arrivalsFor(address: string, since?: string): Arrival[] {
  if (!isAddress(address)) return [];
  const list = recent.get(address.toLowerCase()) ?? [];
  return since ? list.filter((a) => a.at >= since) : list;
}

export function notifyConfigured() {
  return Boolean(process.env.ALCHEMY_NOTIFY_TOKEN?.trim() && process.env.ALCHEMY_WEBHOOK_ID?.trim());
}

/** Start watching a wallet on the Address Activity webhook. Idempotent. */
export async function watchAddress(address: string): Promise<boolean> {
  if (!notifyConfigured() || !isAddress(address)) return false;
  const res = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "X-Alchemy-Token": process.env.ALCHEMY_NOTIFY_TOKEN!.trim(),
    },
    body: JSON.stringify({
      webhook_id: process.env.ALCHEMY_WEBHOOK_ID!.trim(),
      addresses_to_add: [getAddress(address)],
      addresses_to_remove: [],
    }),
    signal: AbortSignal.timeout(5_000),
  });
  return res.ok;
}
