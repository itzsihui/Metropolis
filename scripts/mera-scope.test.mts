/**
 * Offline tests for the passkey signing-session scope.
 *   npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { CHAINS } = await import("../src/lib/chains.ts");
const { capFromPolicy, checkScope, newScope, recordSignature, sessionLive, usd } =
  await import("../src/lib/mera/session-scope.ts");

const monad = CHAINS["eip155:10143"];
const pay = (dollars: number, overrides: Record<string, unknown> = {}) => ({
  domain: { chainId: monad.chainId, verifyingContract: monad.token },
  primaryType: "ReceiveWithAuthorization",
  message: { value: usd(dollars) },
  ...overrides,
});

test("a payment inside the scope signs without a prompt", () => {
  const scope = newScope(0);
  const verdict = checkScope(scope, pay(5), 1_000);
  assert.equal(verdict.ok, true);
});

test("payments above the per-payment cap need the passkey again", () => {
  const verdict = checkScope(newScope(0), pay(26), 1_000);
  assert.equal(verdict.ok, false);
  assert.equal(!verdict.ok && verdict.kind, "over-payment-cap");
});

test("the session cap counts every signature", () => {
  let scope = newScope(0);
  for (let i = 0; i < 4; i++) scope = recordSignature(scope, usd(25), 1_000 + i);
  const verdict = checkScope(scope, pay(1), 2_000);
  assert.equal(!verdict.ok && verdict.kind, "over-session-cap");
});

test("expiry and idle timeouts end the session", () => {
  const scope = newScope(0, { ttlMs: 60_000, idleMs: 10_000 });
  assert.equal(sessionLive(scope, 5_000), true);
  const idle = checkScope(scope, pay(1), 10_000);
  assert.equal(!idle.ok && idle.kind, "idle");
  const used = recordSignature(scope, usd(1), 9_000);
  assert.equal(checkScope(used, pay(1), 15_000).ok, true);
  const expired = checkScope(used, pay(1), 60_000);
  assert.equal(!expired.ok && expired.kind, "expired");
});

test("only stablecoin authorizations on known chains are in scope", () => {
  const scope = newScope(0);
  const permit = checkScope(scope, pay(1, { primaryType: "Permit" }), 1);
  assert.equal(!permit.ok && permit.kind, "type");
  const token = checkScope(
    scope,
    pay(1, { domain: { chainId: monad.chainId, verifyingContract: "0x000000000000000000000000000000000000dEaD" } }),
    1,
  );
  assert.equal(!token.ok && token.kind, "token");
  const chain = checkScope(scope, pay(1, { domain: { chainId: 1, verifyingContract: monad.token } }), 1);
  assert.equal(!chain.ok && chain.kind, "chain");
});

test("a tighter governance limit lowers the prompt-free cap", () => {
  assert.equal(capFromPolicy(10), usd(10));
  assert.equal(capFromPolicy(500), usd(25));
  assert.equal(capFromPolicy(null), usd(25));
});
