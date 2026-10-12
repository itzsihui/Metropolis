import {
  indexer,
  type Buyer,
  type Checkout,
  type DailyStat,
  type Merchant,
  type Token,
} from "envio";

const DAY = 86_400n;
const ZERO = 0n;

const lower = (a: string) => a.toLowerCase();

function defaultCheckout(id: string, now: bigint): Checkout {
  return {
    id,
    feeBps: 0,
    treasury: "",
    paused: false,
    orderCount: 0,
    grossVolume: ZERO,
    feeVolume: ZERO,
    pointsIssued: ZERO,
    merchantCount: 0,
    buyerCount: 0,
    updatedAt: now,
  };
}

function defaultToken(id: string): Token {
  return { id, allowed: false, orderCount: 0, volume: ZERO, fees: ZERO };
}

indexer.onEvent(
  {
    contract: "BorneoCheckout",
    event: "OrderSettled",
    fields: { transaction: ["hash"], block: ["timestamp"] },
  },
  async ({ event, context }) => {
    const { orderId, merchant, payer, token, amount, fee, points } = event.params;
    const now = BigInt(event.block.timestamp);
    const checkoutId = lower(event.srcAddress);
    const merchantId = lower(merchant);
    const buyerId = lower(payer);
    const tokenId = lower(token);
    const dayIndex = now / DAY;
    const dayId = dayIndex.toString();
    const pairId = `${merchantId}-${buyerId}`;
    const dailyBuyerId = `${dayId}-${buyerId}`;

    const [checkout, merchantRow, buyerRow, tokenRow, day, pair, dailyBuyer] = await Promise.all([
      context.Checkout.get(checkoutId),
      context.Merchant.get(merchantId),
      context.Buyer.get(buyerId),
      context.Token.get(tokenId),
      context.DailyStat.get(dayId),
      context.MerchantBuyer.get(pairId),
      context.DailyBuyer.get(dailyBuyerId),
    ]);

    const c = checkout ?? defaultCheckout(checkoutId, now);
    const net = amount - fee;

    context.Order.set({
      id: lower(orderId),
      checkout: checkoutId,
      merchant_id: merchantId,
      buyer_id: buyerId,
      token_id: tokenId,
      amount,
      fee,
      net,
      points,
      feeBps: c.feeBps,
      day_id: dayId,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: now,
    });

    const m: Merchant = merchantRow ?? {
      id: merchantId,
      orderCount: 0,
      grossVolume: ZERO,
      netVolume: ZERO,
      feesPaid: ZERO,
      uniqueBuyers: 0,
      repeatBuyers: 0,
      firstSaleAt: now,
      lastSaleAt: now,
    };
    const firstFromBuyer = pair === undefined;
    const secondFromBuyer = pair?.orderCount === 1;
    context.Merchant.set({
      ...m,
      orderCount: m.orderCount + 1,
      grossVolume: m.grossVolume + amount,
      netVolume: m.netVolume + net,
      feesPaid: m.feesPaid + fee,
      uniqueBuyers: m.uniqueBuyers + (firstFromBuyer ? 1 : 0),
      repeatBuyers: m.repeatBuyers + (secondFromBuyer ? 1 : 0),
      lastSaleAt: now,
    });

    const b: Buyer = buyerRow ?? {
      id: buyerId,
      orderCount: 0,
      spent: ZERO,
      xpoints: ZERO,
      merchantCount: 0,
      firstOrderAt: now,
      lastOrderAt: now,
    };
    context.Buyer.set({
      ...b,
      orderCount: b.orderCount + 1,
      spent: b.spent + amount,
      xpoints: b.xpoints + points,
      merchantCount: b.merchantCount + (firstFromBuyer ? 1 : 0),
      lastOrderAt: now,
    });

    context.MerchantBuyer.set({
      id: pairId,
      merchant_id: merchantId,
      buyer_id: buyerId,
      orderCount: (pair?.orderCount ?? 0) + 1,
      spent: (pair?.spent ?? ZERO) + amount,
    });

    const t = tokenRow ?? defaultToken(tokenId);
    context.Token.set({
      ...t,
      orderCount: t.orderCount + 1,
      volume: t.volume + amount,
      fees: t.fees + fee,
    });

    const d: DailyStat = day ?? {
      id: dayId,
      date: new Date(Number(dayIndex * DAY) * 1000).toISOString().slice(0, 10),
      dayStart: dayIndex * DAY,
      orderCount: 0,
      volume: ZERO,
      fees: ZERO,
      points: ZERO,
      activeBuyers: 0,
    };
    context.DailyStat.set({
      ...d,
      orderCount: d.orderCount + 1,
      volume: d.volume + amount,
      fees: d.fees + fee,
      points: d.points + points,
      activeBuyers: d.activeBuyers + (dailyBuyer === undefined ? 1 : 0),
    });
    if (dailyBuyer === undefined) {
      context.DailyBuyer.set({ id: dailyBuyerId, day_id: dayId });
    }

    context.Checkout.set({
      ...c,
      orderCount: c.orderCount + 1,
      grossVolume: c.grossVolume + amount,
      feeVolume: c.feeVolume + fee,
      pointsIssued: c.pointsIssued + points,
      merchantCount: c.merchantCount + (merchantRow === undefined ? 1 : 0),
      buyerCount: c.buyerCount + (buyerRow === undefined ? 1 : 0),
      updatedAt: now,
    });
  },
);

indexer.onEvent(
  { contract: "BorneoCheckout", event: "TokenAllowed", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const id = lower(event.params.token);
    const existing = await context.Token.get(id);
    context.Token.set({ ...(existing ?? defaultToken(id)), allowed: event.params.allowed });
  },
);

indexer.onEvent(
  { contract: "BorneoCheckout", event: "FeeUpdated", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const id = lower(event.srcAddress);
    const now = BigInt(event.block.timestamp);
    const existing = await context.Checkout.get(id);
    context.Checkout.set({
      ...(existing ?? defaultCheckout(id, now)),
      feeBps: Number(event.params.feeBps),
      updatedAt: now,
    });
  },
);

indexer.onEvent(
  { contract: "BorneoCheckout", event: "TreasuryUpdated", fields: { block: ["timestamp"] } },
  async ({ event, context }) => {
    const id = lower(event.srcAddress);
    const now = BigInt(event.block.timestamp);
    const existing = await context.Checkout.get(id);
    context.Checkout.set({
      ...(existing ?? defaultCheckout(id, now)),
      treasury: lower(event.params.treasury),
      updatedAt: now,
    });
  },
);

for (const name of ["Paused", "Unpaused"] as const) {
  indexer.onEvent(
    { contract: "BorneoCheckout", event: name, fields: { block: ["timestamp"] } },
    async ({ event, context }) => {
      const id = lower(event.srcAddress);
      const now = BigInt(event.block.timestamp);
      const existing = await context.Checkout.get(id);
      context.Checkout.set({
        ...(existing ?? defaultCheckout(id, now)),
        paused: name === "Paused",
        updatedAt: now,
      });
    },
  );
}
