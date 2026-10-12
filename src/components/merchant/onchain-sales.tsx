"use client";

import { useEffect, useState } from "react";

type Reply = {
  configured: boolean;
  error?: string;
  orders?: Array<{
    orderId: string;
    chainLabel?: string;
    buyer: string;
    amount: string;
    net: string;
    txHash: string;
    explorerUrl?: string;
    at: string;
  }>;
  totals?: {
    orderCount: number;
    gross: string;
    net: string;
    fees: string;
    uniqueBuyers: number;
    repeatBuyers: number;
    repeatRate: number;
  };
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (v: string) => `$${Number(v).toFixed(2)}`;

/** Sales to a payout address, straight from the Envio index of BorneoCheckout. */
export function OnchainSales({ address }: { address: string | null }) {
  const [reply, setReply] = useState<Reply | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    void fetch(`/api/onchain/merchant?address=${address}`)
      .then((r) => r.json() as Promise<Reply>)
      .then((data) => alive && setReply(data))
      .catch(() => alive && setReply({ configured: true, error: "Index unreachable" }));
    return () => {
      alive = false;
    };
  }, [address]);

  if (!address || !reply || !reply.configured) return null;

  const t = reply.totals;
  return (
    <section className="mt-6 border border-border bg-background px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          On-chain sales · indexed by Envio
        </p>
        <p className="font-mono text-[10px] text-muted-foreground">{short(address)}</p>
      </div>
      {reply.error ? (
        <p className="mt-2 text-sm text-destructive">{reply.error}</p>
      ) : !t || t.orderCount === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No settled orders to this address yet.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              ["Orders", String(t.orderCount)],
              ["Gross", usd(t.gross)],
              ["Received", usd(t.net)],
              ["Buyers", String(t.uniqueBuyers)],
              ["Repeat", `${Math.round(t.repeatRate * 100)}%`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-4 divide-y divide-border border-t border-border text-xs">
            {(reply.orders ?? []).slice(0, 8).map((o) => (
              <li key={`${o.chainLabel}-${o.orderId}`} className="flex items-center justify-between gap-3 py-2">
                <span className="tabular-nums">
                  {usd(o.amount)} from {short(o.buyer)}
                  <span className="text-muted-foreground"> · {o.chainLabel ?? "?"} · {new Date(o.at).toLocaleDateString()}</span>
                </span>
                {o.explorerUrl ? (
                  <a href={o.explorerUrl} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                    {short(o.txHash)}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
