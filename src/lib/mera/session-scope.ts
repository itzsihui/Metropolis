/**
 * What a passkey signing session may sign without asking again.
 *
 * Unlocking the passkey opens one in-memory session. Inside its scope the
 * buyer agent can sign x402 payments with no prompt: only EIP-3009
 * authorizations, only on known stablecoins, only up to a per-payment and a
 * per-session cap, and only until the session expires or sits idle. Anything
 * else (a bigger payment, an unknown token, a raw transaction, an expired
 * session) needs a fresh passkey ceremony.
 */
import { listChains } from "@/lib/chains";

export type SessionScope = {
  startedAt: number;
  /** Hard end of the session, regardless of activity. */
  expiresAt: number;
  /** The session also ends after this long without a signature. */
  idleMs: number;
  lastUsedAt: number;
  perPaymentCapAtomic: bigint;
  totalCapAtomic: bigint;
  spentAtomic: bigint;
  /** Lowercased token contracts the session may authorize transfers of. */
  tokens: string[];
  chainIds: number[];
};

export type ScopeLimits = {
  /** Session length in ms. Default 30 minutes. */
  ttlMs?: number;
  /** Idle timeout in ms. Default 10 minutes. */
  idleMs?: number;
  perPaymentCapAtomic?: bigint;
  totalCapAtomic?: bigint;
};

/** USDC has 6 decimals on every settlement chain. */
export const usd = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));

export const DEFAULT_LIMITS = {
  ttlMs: 30 * 60_000,
  idleMs: 10 * 60_000,
  perPaymentCapAtomic: usd(25),
  totalCapAtomic: usd(100),
} as const;

export const SCOPED_TYPES = [
  "TransferWithAuthorization",
  "ReceiveWithAuthorization",
] as const;

export function newScope(now: number, limits: ScopeLimits = {}): SessionScope {
  const chains = listChains();
  return {
    startedAt: now,
    expiresAt: now + (limits.ttlMs ?? DEFAULT_LIMITS.ttlMs),
    idleMs: limits.idleMs ?? DEFAULT_LIMITS.idleMs,
    lastUsedAt: now,
    perPaymentCapAtomic: limits.perPaymentCapAtomic ?? DEFAULT_LIMITS.perPaymentCapAtomic,
    totalCapAtomic: limits.totalCapAtomic ?? DEFAULT_LIMITS.totalCapAtomic,
    spentAtomic: BigInt(0),
    tokens: [
      ...new Set(
        chains.flatMap((c) => [c.token, c.usdg]).filter(Boolean).map((t) => t.toLowerCase()),
      ),
    ],
    chainIds: chains.map((c) => c.chainId),
  };
}

/** The parts of an EIP-712 payload the scope looks at. */
export type ScopedTypedData = {
  domain: { chainId?: number | bigint; verifyingContract?: string };
  primaryType: string;
  message: { value?: bigint | string | number };
};

export type ScopeVerdict =
  | { ok: true; amountAtomic: bigint }
  | {
      ok: false;
      kind: "expired" | "idle" | "type" | "token" | "chain" | "over-payment-cap" | "over-session-cap";
      reason: string;
    };

const fmt = (atomic: bigint) => (Number(atomic) / 1_000_000).toFixed(2);

export function sessionLive(scope: SessionScope, now: number) {
  return now < scope.expiresAt && now - scope.lastUsedAt < scope.idleMs;
}

export function checkScope(
  scope: SessionScope,
  typed: ScopedTypedData,
  now: number,
): ScopeVerdict {
  if (now >= scope.expiresAt) {
    return { ok: false, kind: "expired", reason: "Signing session expired" };
  }
  if (now - scope.lastUsedAt >= scope.idleMs) {
    return { ok: false, kind: "idle", reason: "Signing session timed out while idle" };
  }
  if (!(SCOPED_TYPES as readonly string[]).includes(typed.primaryType)) {
    return {
      ok: false,
      kind: "type",
      reason: `${typed.primaryType} is outside the session (payments only)`,
    };
  }
  const token = typed.domain.verifyingContract?.toLowerCase();
  if (!token || !scope.tokens.includes(token)) {
    return { ok: false, kind: "token", reason: `Token ${token ?? "?"} is not a known stablecoin` };
  }
  const chainId = Number(typed.domain.chainId);
  if (!scope.chainIds.includes(chainId)) {
    return { ok: false, kind: "chain", reason: `Chain ${chainId} is outside the session` };
  }
  const amount = BigInt(typed.message.value ?? 0);
  if (amount > scope.perPaymentCapAtomic) {
    return {
      ok: false,
      kind: "over-payment-cap",
      reason: `$${fmt(amount)} is above the $${fmt(scope.perPaymentCapAtomic)} prompt-free limit`,
    };
  }
  if (scope.spentAtomic + amount > scope.totalCapAtomic) {
    return {
      ok: false,
      kind: "over-session-cap",
      reason: `Session already signed $${fmt(scope.spentAtomic)} of $${fmt(scope.totalCapAtomic)}`,
    };
  }
  return { ok: true, amountAtomic: amount };
}

export function recordSignature(
  scope: SessionScope,
  amountAtomic: bigint,
  now: number,
): SessionScope {
  return { ...scope, spentAtomic: scope.spentAtomic + amountAtomic, lastUsedAt: now };
}

/** Lower the per-payment cap to the buyer's own governance limit, if tighter. */
export function capFromPolicy(maxPerTransaction: number | null | undefined) {
  if (!maxPerTransaction || maxPerTransaction <= 0) return DEFAULT_LIMITS.perPaymentCapAtomic;
  const own = usd(maxPerTransaction);
  return own < DEFAULT_LIMITS.perPaymentCapAtomic ? own : DEFAULT_LIMITS.perPaymentCapAtomic;
}
