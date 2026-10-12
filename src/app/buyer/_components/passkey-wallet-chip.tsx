"use client";

import { useEffect, useState } from "react";
import { usePasskeyWallet } from "./passkey-wallet-provider";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const dollars = (atomic: bigint) => (Number(atomic) / 1_000_000).toFixed(2);

/** Shows who is signed in and how much of the prompt-free session is left. */
export function PasskeyWalletChip() {
  const wallet = usePasskeyWallet();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (wallet.status !== "active") return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [wallet.status]);

  if (!wallet.address) return null;
  const scope = wallet.scope;
  const minutesLeft = scope ? Math.max(0, Math.ceil((scope.expiresAt - now) / 60_000)) : 0;

  return (
    <div className="flex shrink-0 items-center gap-2 text-xs">
      <span
        className={
          wallet.status === "active"
            ? "size-1.5 rounded-full bg-emerald-500"
            : "size-1.5 rounded-full bg-foreground/30"
        }
        aria-hidden
      />
      <span className="font-mono text-foreground/70" title={wallet.address}>
        {short(wallet.address)}
      </span>
      {wallet.status === "active" && scope ? (
        <>
          <span className="hidden text-foreground/45 md:inline">
            ${dollars(scope.totalCapAtomic - scope.spentAtomic)} prompt-free · {minutesLeft} min
          </span>
          <button
            type="button"
            onClick={wallet.lock}
            className="text-foreground/55 underline-offset-2 hover:underline"
          >
            Lock
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={wallet.busy}
          onClick={() => void wallet.unlock().catch(() => undefined)}
          className="text-foreground/70 underline-offset-2 hover:underline"
        >
          {wallet.busy ? "Waiting…" : "Unlock"}
        </button>
      )}
    </div>
  );
}
