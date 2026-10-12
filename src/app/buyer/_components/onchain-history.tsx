"use client";

import { useEffect, useState } from "react";
import { pointsFromFeeAtomic } from "@/lib/ownership-math";
import { usePasskeyWallet } from "./passkey-wallet-provider";

type Order = {
  orderId: string;
  chainLabel?: string;
  merchant: string;
  amount: string;
  fee: string;
  points: string;
  txHash: string;
  explorerUrl?: string;
  at: string;
};

type Reply = {
  configured: boolean;
  error?: string;
  orders?: Order[];
  totals?: {
    orderCount: number;
    spent: string;
    xpoints: string;
    merchants: number;
    chains: number;
  };
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Fetch the signed-in wallet's indexed orders; null until loaded. */
export function useOnchainHistory() {
  const wallet = usePasskeyWallet();
  const [reply, setReply] = useState<Reply | null>(null);
  const address = wallet.address;

  useEffect(() => {
    if (!address) return;
    let alive = true;
    void fetch(`/api/onchain/buyer?address=${address}`)
      .then((r) => r.json() as Promise<Reply>)
      .then((data) => alive && setReply(data))
      .catch(() => alive && setReply({ configured: true, error: "Index unreachable" }));
    return () => {
      alive = false;
    };
  }, [address]);

  return { address, reply };
}

/**
 * Orders rebuilt from chain by the Envio indexer, keyed only by the passkey
 * wallet address. Survives cleared storage and new devices.
 */
export function OnchainHistory() {
  const { address, reply } = useOnchainHistory();
  if (!address) return null;

  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">On-chain orders</h2>
        <p className="font-mono text-[11px] text-muted-foreground">
          {short(address)} · indexed by Envio
        </p>
      </div>
      {!reply ? (
        <p className="mt-3 text-sm text-foreground/50">Loading…</p>
      ) : !reply.configured ? (
        <p className="mt-3 text-sm text-foreground/50">
          Set ENVIO_GRAPHQL_URL to rebuild history from chain.
        </p>
      ) : reply.error ? (
        <p className="mt-3 text-sm text-destructive">{reply.error}</p>
      ) : !reply.orders?.length ? (
        <p className="mt-3 text-sm text-foreground/50">No settled orders for this wallet yet.</p>
      ) : (
        <>
          {reply.totals ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {reply.totals.orderCount} orders · ${Number(reply.totals.spent).toFixed(2)} spent ·{" "}
              {pointsFromFeeAtomic(reply.totals.xpoints)} XPoints ·{" "}
              {reply.totals.merchants} merchants · {reply.totals.chains} chain
              {reply.totals.chains === 1 ? "" : "s"}
            </p>
          ) : null}
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {reply.orders.map((o) => (
              <li key={`${o.chainLabel}-${o.orderId}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="tabular-nums">${Number(o.amount).toFixed(2)} to {short(o.merchant)}</p>
                  <p className="text-xs text-foreground/50">
                    {new Date(o.at).toLocaleString()} · {o.chainLabel ?? "unknown chain"} · +
                    {pointsFromFeeAtomic(o.points)} XPoints
                  </p>
                </div>
                {o.explorerUrl ? (
                  <a
                    href={o.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-foreground/70 underline-offset-2 hover:underline"
                  >
                    {short(o.txHash)}
                  </a>
                ) : (
                  <span className="font-mono text-xs text-foreground/50">{short(o.txHash)}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
