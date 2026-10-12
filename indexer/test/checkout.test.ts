import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

const MERCHANT = "0x1111111111111111111111111111111111111111";
const BUYER_A = "0x2222222222222222222222222222222222222222";
const BUYER_B = "0x3333333333333333333333333333333333333333";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const order = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const settled = (id: number, payer: string, amount: bigint, fee: bigint) => ({
  contract: "BorneoCheckout" as const,
  event: "OrderSettled" as const,
  params: {
    orderId: order(id),
    merchant: MERCHANT,
    payer,
    token: USDC,
    amount,
    fee,
    points: fee,
  },
});

describe("BorneoCheckout indexer", () => {
  it("rolls orders up per merchant, buyer, token and day", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            { contract: "BorneoCheckout", event: "FeeUpdated", params: { feeBps: 50n } },
            { contract: "BorneoCheckout", event: "TokenAllowed", params: { token: USDC, allowed: true } },
            settled(1, BUYER_A, 20_000n, 100n),
            settled(2, BUYER_A, 30_000n, 150n),
            settled(3, BUYER_B, 10_000n, 50n),
          ],
        },
      },
    });

    const merchant = await indexer.Merchant.getOrThrow(MERCHANT.toLowerCase());
    t.expect(merchant.orderCount).toBe(3);
    t.expect(merchant.grossVolume).toBe(60_000n);
    t.expect(merchant.netVolume).toBe(59_700n);
    t.expect(merchant.feesPaid).toBe(300n);
    t.expect(merchant.uniqueBuyers).toBe(2);
    t.expect(merchant.repeatBuyers).toBe(1);

    const buyer = await indexer.Buyer.getOrThrow(BUYER_A.toLowerCase());
    t.expect(buyer.orderCount).toBe(2);
    t.expect(buyer.spent).toBe(50_000n);
    t.expect(buyer.xpoints).toBe(250n);
    t.expect(buyer.merchantCount).toBe(1);

    const token = await indexer.Token.getOrThrow(USDC.toLowerCase());
    t.expect(token.allowed).toBe(true);
    t.expect(token.orderCount).toBe(3);
    t.expect(token.volume).toBe(60_000n);

    const orders = await indexer.Order.getAll();
    t.expect(orders).toHaveLength(3);
    t.expect(orders.every((o) => o.feeBps === 50)).toBe(true);
    t.expect(orders.find((o) => o.id === order(1))?.net).toBe(19_900n);

    const days = await indexer.DailyStat.getAll();
    t.expect(days.reduce((n, d) => n + d.orderCount, 0)).toBe(3);
    t.expect(days.reduce((n, d) => n + d.activeBuyers, 0)).toBeGreaterThanOrEqual(2);

    const checkouts = await indexer.Checkout.getAll();
    t.expect(checkouts).toHaveLength(1);
    t.expect(checkouts[0]?.orderCount).toBe(3);
    t.expect(checkouts[0]?.merchantCount).toBe(1);
    t.expect(checkouts[0]?.buyerCount).toBe(2);
  });

  it("tracks pause state", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            { contract: "BorneoCheckout", event: "Paused", params: { account: MERCHANT } },
          ],
        },
      },
    });
    const [checkout] = await indexer.Checkout.getAll();
    t.expect(checkout?.paused).toBe(true);
  });
});
