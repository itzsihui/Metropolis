"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Hex } from "viem";
import {
  createPasskeyAccount,
  passkeyErrorMessage,
  unlockPasskeyAccount,
  type PasskeyUnlock,
} from "@/lib/mera/passkey-account";
import {
  capFromPolicy,
  checkScope,
  newScope,
  recordSignature,
  sessionLive,
  type ScopedTypedData,
  type SessionScope,
} from "@/lib/mera/session-scope";

/**
 * The buyer's whole account layer: one passkey, one in-memory signing
 * session. Nothing secret is stored. The only thing kept in localStorage is a
 * hint (credential id + address) so the next visit can say "Continue as
 * 0x12…" and pin the right passkey. Clear it and the account still rebuilds
 * from the passkey alone.
 */
const HINT_KEY = "borneo.passkey.hint.v1";

export type PasskeyHint = { credentialId: string; address: `0x${string}` };

export type WalletStatus = "locked" | "active";

export type SignOutcome = { signature: Hex; prompted: boolean; reason?: string };

type PasskeyWalletValue = {
  status: WalletStatus;
  /** Known even while locked when a hint exists, so the UI can show it. */
  address: `0x${string}` | null;
  hint: PasskeyHint | null;
  scope: SessionScope | null;
  busy: boolean;
  error: string | null;
  /** One ceremony: new passkey, new account, session open. */
  create: (label?: string) => Promise<`0x${string}`>;
  /** One ceremony: rebuild the account from an existing passkey. */
  unlock: () => Promise<`0x${string}`>;
  /** End the session now. The key copy in memory is zeroed. */
  lock: () => void;
  /** Forget this device's hint. The passkey and the account are unaffected. */
  forget: () => void;
  /**
   * Sign an EIP-712 payment. Inside the session scope this is prompt-free;
   * outside it (over the cap, expired, not a payment) the passkey is asked
   * again first, and `prompted` says so.
   */
  signTypedData: (typed: ScopedTypedData & Record<string, unknown>) => Promise<SignOutcome>;
  setPerPaymentCap: (maxPerTransaction: number | null | undefined) => void;
};

const PasskeyWalletContext = createContext<PasskeyWalletValue | null>(null);

const HINT_EVENT = "borneo:passkey-hint";

function readHintRaw(): string | null {
  try {
    return localStorage.getItem(HINT_KEY);
  } catch {
    return null;
  }
}

function subscribeHint(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(HINT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(HINT_EVENT, onChange);
  };
}

function parseHint(raw: string | null): PasskeyHint | null {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PasskeyHint>;
    return parsed.credentialId && parsed.address?.startsWith("0x")
      ? { credentialId: parsed.credentialId, address: parsed.address }
      : null;
  } catch {
    return null;
  }
}

function readHint() {
  return parseHint(readHintRaw());
}

function writeHint(hint: PasskeyHint | null) {
  try {
    if (hint) localStorage.setItem(HINT_KEY, JSON.stringify(hint));
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // private mode: the passkey still works, the next visit just asks which one
  }
  window.dispatchEvent(new Event(HINT_EVENT));
}

export function PasskeyWalletProvider({ children }: { children: React.ReactNode }) {
  const unlocked = useRef<PasskeyUnlock | null>(null);
  const capRef = useRef<bigint | undefined>(undefined);
  const hintRaw = useSyncExternalStore(subscribeHint, readHintRaw, () => null);
  const hint = useMemo(() => parseHint(hintRaw), [hintRaw]);
  const [status, setStatus] = useState<WalletStatus>("locked");
  const [activeAddress, setActiveAddress] = useState<`0x${string}` | null>(null);
  const [scope, setScope] = useState<SessionScope | null>(null);
  const scopeRef = useRef<SessionScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endSession = useCallback(() => {
    try {
      unlocked.current?.session.end();
    } catch {
      // already ended
    }
    unlocked.current = null;
    scopeRef.current = null;
    setScope(null);
    setStatus("locked");
    setActiveAddress(null);
  }, []);

  const adopt = useCallback((next: PasskeyUnlock) => {
    try {
      unlocked.current?.session.end();
    } catch {
      // already ended
    }
    unlocked.current = next;
    const fresh = newScope(Date.now(), { perPaymentCapAtomic: capRef.current });
    scopeRef.current = fresh;
    setScope(fresh);
    setStatus("active");
    setActiveAddress(next.address);
    writeHint({ credentialId: next.credentialId, address: next.address });
    setError(null);
  }, []);

  // Expire the session on time even if nothing is signed.
  useEffect(() => {
    if (status !== "active") return;
    const timer = setInterval(() => {
      const current = scopeRef.current;
      if (!current || !sessionLive(current, Date.now())) endSession();
    }, 5_000);
    return () => clearInterval(timer);
  }, [status, endSession]);

  // Zero the key when the tab goes away.
  useEffect(() => {
    const onHide = () => endSession();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [endSession]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(passkeyErrorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (label?: string) =>
      run(async () => {
        const next = await createPasskeyAccount(label);
        adopt(next);
        return next.address;
      }),
    [run, adopt],
  );

  const unlock = useCallback(
    () =>
      run(async () => {
        const next = await unlockPasskeyAccount(readHint()?.credentialId);
        adopt(next);
        return next.address;
      }),
    [run, adopt],
  );

  const signTypedData = useCallback(
    async (typed: ScopedTypedData & Record<string, unknown>): Promise<SignOutcome> => {
      const now = Date.now();
      const current = scopeRef.current;
      const verdict = current && unlocked.current ? checkScope(current, typed, now) : null;

      if (verdict?.ok && unlocked.current && current) {
        const signature = await unlocked.current.account.signTypedData(
          typed as Parameters<PasskeyUnlock["account"]["signTypedData"]>[0],
        );
        const next = recordSignature(current, verdict.amountAtomic, now);
        scopeRef.current = next;
        setScope(next);
        return { signature, prompted: false };
      }

      // Outside the scope: ask the passkey again (step-up).
      const reason = verdict && !verdict.ok ? verdict.reason : "Wallet is locked";
      const expectedAddress = readHint()?.address;
      return run(async () => {
        const fresh = await unlockPasskeyAccount(readHint()?.credentialId);
        if (expectedAddress && fresh.address.toLowerCase() !== expectedAddress.toLowerCase()) {
          fresh.session.end();
          throw new Error("That passkey belongs to a different account");
        }
        const signature = await fresh.account.signTypedData(
          typed as Parameters<PasskeyUnlock["account"]["signTypedData"]>[0],
        );
        const overCap =
          verdict && !verdict.ok &&
          (verdict.kind === "over-payment-cap" || verdict.kind === "type" || verdict.kind === "token" || verdict.kind === "chain");
        if (overCap && unlocked.current && scopeRef.current) {
          // One-off approval: keep the existing session, drop the extra key copy.
          fresh.session.end();
        } else {
          // Expired, idle or locked: the new ceremony opens a new session.
          adopt(fresh);
        }
        return { signature, prompted: true, reason };
      });
    },
    [run, adopt],
  );

  const setPerPaymentCap = useCallback((maxPerTransaction: number | null | undefined) => {
    capRef.current = capFromPolicy(maxPerTransaction);
    const current = scopeRef.current;
    if (current && current.perPaymentCapAtomic !== capRef.current) {
      const next = { ...current, perPaymentCapAtomic: capRef.current };
      scopeRef.current = next;
      setScope(next);
    }
  }, []);

  const forget = useCallback(() => {
    endSession();
    writeHint(null);
  }, [endSession]);

  const value = useMemo<PasskeyWalletValue>(
    () => ({
      status,
      address: activeAddress ?? hint?.address ?? null,
      hint,
      scope,
      busy,
      error,
      create,
      unlock,
      lock: endSession,
      forget,
      signTypedData,
      setPerPaymentCap,
    }),
    [status, activeAddress, hint, scope, busy, error, create, unlock, endSession, forget, signTypedData, setPerPaymentCap],
  );

  return (
    <PasskeyWalletContext.Provider value={value}>{children}</PasskeyWalletContext.Provider>
  );
}

export function usePasskeyWallet() {
  const ctx = useContext(PasskeyWalletContext);
  if (!ctx) throw new Error("usePasskeyWallet must be used within PasskeyWalletProvider");
  return ctx;
}
