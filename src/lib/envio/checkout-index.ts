import { getAddress, isAddress } from "viem";
import { listChains } from "@/lib/chains";
import { chainSettings, config, explorerTx } from "@/lib/config";

/**
 * Reads the Envio HyperIndex GraphQL API built from indexer/ (BorneoCheckout
 * orders and rollups across chains). Set ENVIO_GRAPHQL_URL to the endpoint
 * from Envio Cloud, or http://localhost:8080/v1/graphql for `envio dev`.
 *
 * This is what lets a passkey shopper clear local storage, sign in on a new
 * device, and still see every order and XPoint: the history comes from chain.
 */
const KNOWN_CHECKOUTS: Record<string, string> = {
  // Live deployments indexed by default (see indexer/config.yaml).
  "0xf8188490c10d0248dbb27bd1a07f8a7b4f0e9fc4": "eip155:421614",
  "0x3ad9d36fd382162e206415ff1736e78bf8326d28": "eip155:84532",
};

export function indexConfigured() {
  return Boolean(process.env.ENVIO_GRAPHQL_URL?.trim());
}

/** Which chain a checkout lives on: env-configured checkouts first, then known ones. */
export function networkForCheckout(checkout: string): string | undefined {
  const wanted = checkout.toLowerCase();
  for (const chain of listChains()) {
    const addr = chainSettings(chain.network).checkoutAddress;
    if (addr && addr.toLowerCase() === wanted) return chain.network;
  }
  return KNOWN_CHECKOUTS[wanted];
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const url = process.env.ENVIO_GRAPHQL_URL?.trim();
  if (!url) throw new Error("ENVIO_GRAPHQL_URL is not set");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = process.env.ENVIO_GRAPHQL_SECRET?.trim();
  if (secret) headers["x-hasura-admin-secret"] = secret;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || body.errors?.length) {
    throw new Error(body.errors?.map((e) => e.message).join("; ") || `Envio HTTP ${res.status}`);
  }
  return body.data as T;
}

type OrderRow = {
  id: string;
  checkout: string;
  merchant_id: string;
  buyer_id: string;
  token_id: string;
  amount: string;
  fee: string;
  net: string;
  points: string;
  txHash: string;
  timestamp: string;
};

export type IndexedOrder = {
  orderId: string;
  network?: string;
  chainLabel?: string;
  merchant: string;
  buyer: string;
  token: string;
  amount: string;
  fee: string;
  net: string;
  points: string;
  txHash: string;
  explorerUrl?: string;
  at: string;
};

const ORDER_FIELDS = `id checkout merchant_id buyer_id token_id amount fee net points txHash timestamp`;

const toUsd = (atomic: string) => (Number(atomic) / 10 ** config.tokenDecimals).toString();

function mapOrder(row: OrderRow): IndexedOrder {
  const network = networkForCheckout(row.checkout);
  return {
    orderId: row.id,
    network,
    chainLabel: network ? chainSettings(network).label : undefined,
    merchant: row.merchant_id,
    buyer: row.buyer_id,
    token: row.token_id,
    amount: toUsd(row.amount),
    fee: toUsd(row.fee),
    net: toUsd(row.net),
    points: row.points,
    txHash: row.txHash,
    explorerUrl: network ? explorerTx(row.txHash, network) : undefined,
    at: new Date(Number(row.timestamp) * 1000).toISOString(),
  };
}

function sumBy<T>(rows: T[], pick: (r: T) => string | number) {
  return rows.reduce((n, r) => n + BigInt(pick(r)), BigInt(0));
}

function normalize(address: string) {
  if (!isAddress(address)) throw new Error("Invalid address");
  return getAddress(address).toLowerCase();
}

/** A shopper's orders and XPoints on every indexed chain. */
export async function buyerHistory(address: string, limit = 50) {
  const id = normalize(address);
  const data = await gql<{
    Order: OrderRow[];
    Buyer: Array<{ orderCount: number; spent: string; xpoints: string; merchantCount: number }>;
  }>(
    `query BuyerHistory($id: String!, $limit: Int!) {
      Order(where: { buyer_id: { _eq: $id } }, order_by: { timestamp: desc }, limit: $limit) { ${ORDER_FIELDS} }
      Buyer(where: { id: { _eq: $id } }) { orderCount spent xpoints merchantCount }
    }`,
    { id, limit },
  );
  const rows = data.Buyer ?? [];
  return {
    address: id,
    orders: (data.Order ?? []).map(mapOrder),
    totals: {
      orderCount: rows.reduce((n, r) => n + r.orderCount, 0),
      spent: toUsd(sumBy(rows, (r) => r.spent).toString()),
      xpoints: sumBy(rows, (r) => r.xpoints).toString(),
      merchants: rows.reduce((n, r) => n + r.merchantCount, 0),
      chains: rows.length,
    },
  };
}

/** A merchant's sales, buyers and recent orders on every indexed chain. */
export async function merchantSales(address: string, limit = 20) {
  const id = normalize(address);
  const data = await gql<{
    Order: OrderRow[];
    Merchant: Array<{
      orderCount: number;
      grossVolume: string;
      netVolume: string;
      feesPaid: string;
      uniqueBuyers: number;
      repeatBuyers: number;
      lastSaleAt: string;
    }>;
  }>(
    `query MerchantSales($id: String!, $limit: Int!) {
      Order(where: { merchant_id: { _eq: $id } }, order_by: { timestamp: desc }, limit: $limit) { ${ORDER_FIELDS} }
      Merchant(where: { id: { _eq: $id } }) { orderCount grossVolume netVolume feesPaid uniqueBuyers repeatBuyers lastSaleAt }
    }`,
    { id, limit },
  );
  const rows = data.Merchant ?? [];
  const unique = rows.reduce((n, r) => n + r.uniqueBuyers, 0);
  const repeat = rows.reduce((n, r) => n + r.repeatBuyers, 0);
  return {
    address: id,
    orders: (data.Order ?? []).map(mapOrder),
    totals: {
      orderCount: rows.reduce((n, r) => n + r.orderCount, 0),
      gross: toUsd(sumBy(rows, (r) => r.grossVolume).toString()),
      net: toUsd(sumBy(rows, (r) => r.netVolume).toString()),
      fees: toUsd(sumBy(rows, (r) => r.feesPaid).toString()),
      uniqueBuyers: unique,
      repeatBuyers: repeat,
      repeatRate: unique ? repeat / unique : 0,
    },
  };
}

/** Protocol-wide totals and the last two weeks of daily volume. */
export async function protocolOverview() {
  const data = await gql<{
    Checkout: Array<{
      id: string;
      orderCount: number;
      grossVolume: string;
      feeVolume: string;
      pointsIssued: string;
      merchantCount: number;
      buyerCount: number;
      feeBps: number;
      paused: boolean;
    }>;
    DailyStat: Array<{ date: string; orderCount: number; volume: string; activeBuyers: number }>;
  }>(
    `query Overview {
      Checkout { id orderCount grossVolume feeVolume pointsIssued merchantCount buyerCount feeBps paused }
      DailyStat(order_by: { dayStart: desc }, limit: 28) { date orderCount volume activeBuyers }
    }`,
    {},
  );
  const byDate = new Map<string, { orders: number; volume: bigint; buyers: number }>();
  for (const d of data.DailyStat ?? []) {
    const cur = byDate.get(d.date) ?? { orders: 0, volume: BigInt(0), buyers: 0 };
    byDate.set(d.date, {
      orders: cur.orders + d.orderCount,
      volume: cur.volume + BigInt(d.volume),
      buyers: cur.buyers + d.activeBuyers,
    });
  }
  return {
    checkouts: (data.Checkout ?? []).map((c) => {
      const network = networkForCheckout(c.id);
      return {
        address: c.id,
        network,
        chainLabel: network ? chainSettings(network).label : undefined,
        orderCount: c.orderCount,
        gross: toUsd(c.grossVolume),
        fees: toUsd(c.feeVolume),
        pointsIssued: c.pointsIssued,
        merchants: c.merchantCount,
        buyers: c.buyerCount,
        feeBps: c.feeBps,
        paused: c.paused,
      };
    }),
    days: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, d]) => ({
        date,
        orders: d.orders,
        volume: toUsd(d.volume.toString()),
        buyers: d.buyers,
      })),
  };
}
