/**
 * Offline tests for the Alchemy Address Activity webhook.
 *   npm test
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

process.env.ALCHEMY_WEBHOOK_SIGNING_KEY = "whsec_test";
const { arrivalsFor, parseArrivals, recordArrivals, verifyAlchemySignature } = await import(
  "../src/lib/alchemy/webhooks.ts"
);

const WALLET = "0x2222222222222222222222222222222222222222";
const USDC_MONAD = "0x754704bc059f8c67012fed69bc8a327a5aafb603";
const payload = {
  webhookId: "wh_1",
  id: "whevt_1",
  createdAt: "2026-10-12T05:00:00.000Z",
  type: "ADDRESS_ACTIVITY",
  event: {
    network: "MONAD_MAINNET",
    activity: [
      {
        fromAddress: "0x9999999999999999999999999999999999999999",
        toAddress: WALLET,
        hash: "0xabc",
        value: 5,
        asset: "USDC",
        category: "token",
        rawContract: { address: USDC_MONAD, rawValue: "0x4c4b40", decimals: 6 },
      },
      {
        fromAddress: "0x9999999999999999999999999999999999999999",
        toAddress: WALLET,
        hash: "0xdef",
        value: 1,
        asset: "SPAM",
        category: "token",
        rawContract: { address: "0x000000000000000000000000000000000000dead" },
      },
    ],
  },
};

test("signatures are HMAC-SHA256 of the raw body", () => {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", "whsec_test").update(raw).digest("hex");
  assert.equal(verifyAlchemySignature(raw, sig), true);
  assert.equal(verifyAlchemySignature(raw + " ", sig), false);
  assert.equal(verifyAlchemySignature(raw, null), false);
  assert.equal(verifyAlchemySignature(raw, "00"), false);
});

test("only known stablecoin transfers count as arrivals", () => {
  const arrivals = parseArrivals(payload);
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].address, WALLET);
  assert.equal(arrivals[0].token, USDC_MONAD);
  recordArrivals(arrivals);
  recordArrivals(arrivals);
  assert.equal(arrivalsFor(WALLET).length, 1);
  assert.equal(arrivalsFor(WALLET, "2026-10-12T06:00:00.000Z").length, 0);
});
