"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { usePasskeyWallet } from "../_components/passkey-wallet-provider";

type Origin = {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price: number;
  evm: boolean;
};

type TokensResponse = {
  configured: boolean;
  error?: string;
  destination?: { assetId: string; symbol: string; decimals: number };
  origins?: Origin[];
};

type Quote = {
  amountInFormatted: string;
  amountInUsd: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  timeEstimate: number;
  deadline?: string;
  depositAddress?: string;
  depositMemo?: string;
};

type StatusReply = {
  status?: string;
  error?: string;
  swapDetails?: {
    originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    amountOutFormatted?: string;
    refundReason?: string;
    refundedAmountFormatted?: string;
  };
};

const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
  sol: "Solana",
  btc: "Bitcoin",
  near: "NEAR",
  ton: "TON",
  tron: "Tron",
  sui: "Sui",
  xrp: "XRP Ledger",
  doge: "Dogecoin",
  zec: "Zcash",
  ltc: "Litecoin",
  gnosis: "Gnosis",
  bera: "Berachain",
  starknet: "Starknet",
  cardano: "Cardano",
  aptos: "Aptos",
  stellar: "Stellar",
  scroll: "Scroll",
  plasma: "Plasma",
  xlayer: "X Layer",
  bch: "Bitcoin Cash",
  dash: "Dash",
  adi: "ADI",
  aleo: "Aleo",
};

const STAGES = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"] as const;
const STAGE_LABEL: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen on the origin chain",
  PROCESSING: "Swapping and delivering to Monad",
  SUCCESS: "USDC arrived in your wallet",
  INCOMPLETE_DEPOSIT: "Deposit was below the quoted amount",
  REFUNDED: "Swap could not complete: refunded",
  FAILED: "Swap failed",
};
const FINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
const PREFERRED = ["base", "arb", "eth", "sol", "op", "pol", "bsc", "btc", "near"];

const chainName = (b: string) => CHAIN_NAMES[b] ?? b.toUpperCase();
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const usdc = (atomic: string) => (Number(atomic) / 1_000_000).toFixed(2);

function FundInner() {
  const params = useSearchParams();
  const wallet = usePasskeyWallet();
  const needAtomic = params.get("need") ?? "";
  const returnTo = params.get("return") || "/buyer";

  const [tokens, setTokens] = useState<TokensResponse | null>(null);
  const [blockchain, setBlockchain] = useState("base");
  const [assetId, setAssetId] = useState("");
  const [amountUsd, setAmountUsd] = useState(() =>
    /^\d+$/.test(needAtomic) ? usdc(needAtomic) : "5.00",
  );
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [preview, setPreview] = useState<Quote | null>(null);
  const [status, setStatus] = useState<StatusReply | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");
  const [quotedAt, setQuotedAt] = useState<string | null>(null);
  const [arrival, setArrival] = useState<{ value: string; asset: string; hash: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/aurora/tokens")
      .then((r) => r.json() as Promise<TokensResponse>)
      .then((data) => alive && setTokens(data))
      .catch(() => alive && setTokens({ configured: false, error: "Token list unavailable" }));
    return () => {
      alive = false;
    };
  }, []);

  const chains = useMemo(() => {
    const set = [...new Set((tokens?.origins ?? []).map((o) => o.blockchain))];
    return set.sort(
      (a, b) =>
        (PREFERRED.indexOf(a) + 100) % 100 - (PREFERRED.indexOf(b) + 100) % 100 ||
        chainName(a).localeCompare(chainName(b)),
    );
  }, [tokens]);
  const assets = useMemo(
    () => (tokens?.origins ?? []).filter((o) => o.blockchain === blockchain),
    [tokens, blockchain],
  );
  const origin =
    assets.find((a) => a.assetId === assetId) ??
    assets.find((a) => a.symbol.toUpperCase() === "USDC") ??
    assets[0];
  const refundAddress = origin?.evm && !refundTo.trim() ? (wallet.address ?? "") : refundTo.trim();
  const amountAtomic = useMemo(() => {
    const n = Number(amountUsd);
    return Number.isFinite(n) && n > 0 ? String(Math.round(n * 1_000_000)) : "";
  }, [amountUsd]);

  const loadBalance = useCallback(async () => {
    if (!wallet.address) return;
    const res = await fetch(
      `/api/wallet/balance?address=${wallet.address}&network=eip155:143`,
    ).catch(() => null);
    const data = res ? ((await res.json()) as { balance?: string }) : null;
    if (data?.balance !== undefined) setBalance(data.balance);
  }, [wallet.address]);

  useEffect(() => {
    const timer = setTimeout(() => void loadBalance(), 0);
    return () => clearTimeout(timer);
  }, [loadBalance]);

  // Live price preview while choosing (no deposit address yet).
  useEffect(() => {
    if (!origin || !amountAtomic || !wallet.address || !refundAddress || quote) return;
    const timer = setTimeout(() => {
      void fetch("/api/aurora/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dry: true,
          mode: "exact-out",
          originAsset: origin.assetId,
          amount: amountAtomic,
          recipient: wallet.address,
          refundTo: refundAddress,
        }),
      })
        .then((r) => r.json())
        .then((data: { quote?: Quote; error?: string }) => {
          setPreview(data.quote ?? null);
          setError(data.error ?? null);
        })
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [origin, amountAtomic, wallet.address, refundAddress, quote]);

  // Poll the swap once there is a deposit address.
  useEffect(() => {
    const deposit = quote?.depositAddress;
    if (!deposit || (status?.status && FINAL.has(status.status))) return;
    const poll = async () => {
      const qs = new URLSearchParams({ depositAddress: deposit });
      if (quote?.depositMemo) qs.set("depositMemo", quote.depositMemo);
      const data = (await fetch(`/api/aurora/status?${qs}`)
        .then((r) => r.json())
        .catch(() => null)) as StatusReply | null;
      if (data?.status) setStatus(data);
      if (data?.status === "SUCCESS") void loadBalance();
      // Alchemy pushes the delivery to us as soon as it lands (when webhooks are set up).
      if (wallet.address && quotedAt) {
        const pushed = (await fetch(
          `/api/alchemy/arrivals?address=${wallet.address}&since=${encodeURIComponent(quotedAt)}`,
        )
          .then((r) => r.json())
          .catch(() => null)) as { arrivals?: Array<{ value: string; asset: string; hash: string }> } | null;
        const last = pushed?.arrivals?.at(-1);
        if (last) {
          setArrival(last);
          void loadBalance();
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5_000);
    return () => clearInterval(timer);
  }, [quote, status?.status, loadBalance, wallet.address, quotedAt]);

  async function getDepositAddress() {
    if (!origin || !amountAtomic || !wallet.address) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/aurora/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dry: false,
          mode: "exact-out",
          originAsset: origin.assetId,
          amount: amountAtomic,
          recipient: wallet.address,
          refundTo: refundAddress,
        }),
      });
      const data = (await res.json()) as { quote?: Quote; error?: string };
      if (!res.ok || !data.quote?.depositAddress) {
        throw new Error(data.error || "No deposit address returned");
      }
      setQuote(data.quote);
      setQuotedAt(new Date().toISOString());
      setArrival(null);
      setStatus({ status: "PENDING_DEPOSIT" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  }

  async function reportTx() {
    if (!quote?.depositAddress || !txHash.trim()) return;
    const data = (await fetch("/api/aurora/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: txHash.trim(),
        depositAddress: quote.depositAddress,
        memo: quote.depositMemo,
      }),
    })
      .then((r) => r.json())
      .catch(() => null)) as StatusReply | null;
    if (data?.status) setStatus(data);
    else if (data?.error) setError(data.error);
  }

  function reset() {
    setQuote(null);
    setStatus(null);
    setTxHash("");
  }

  const stageIndex = status?.status ? STAGES.indexOf(status.status as (typeof STAGES)[number]) : -1;
  const done = status?.status === "SUCCESS";

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
      <header className="space-y-2">
        <h1 className="font-[family-name:var(--font-syne)] text-2xl font-semibold tracking-tight">
          Top up from any chain
        </h1>
        <p className="text-sm leading-relaxed text-foreground/60">
          Pay with what you already hold (USDC on Base, ETH on Arbitrum, SOL,
          BTC and more). Aurora Intents swaps it and delivers USDC to your
          passkey wallet on Monad. No bridge, no gas token, no second wallet.
        </p>
      </header>

      <section className="grid gap-3 border border-border px-5 py-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-foreground/45">Delivers to</p>
          <p className="mt-1 font-mono">{wallet.address ? short(wallet.address) : "Unlock your passkey"}</p>
          <p className="text-xs text-foreground/45">USDC · Monad</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs text-foreground/45">Wallet balance on Monad</p>
          <p className="mt-1 tabular-nums">{balance ?? "…"} USDC</p>
          {/^\d+$/.test(needAtomic) ? (
            <p className="text-xs text-foreground/45">Order is short {usdc(needAtomic)} USDC</p>
          ) : null}
        </div>
      </section>

      {config.isTestnet ? (
        <p className="border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-foreground/70">
          Aurora Intents runs on mainnets, so this delivers real USDC on Monad
          mainnet, while this site settles orders on {config.chainLabel}. Run
          with CHAIN_NETWORK=eip155:143 to shop with what you top up.
        </p>
      ) : null}

      {tokens && !tokens.configured ? (
        <p className="text-sm text-destructive">{tokens.error}</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!quote ? (
        <section className="space-y-4 border border-border bg-muted/30 px-5 py-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs text-foreground/55">
              <span>Pay from</span>
              <select
                value={blockchain}
                onChange={(e) => {
                  setBlockchain(e.target.value);
                  setAssetId("");
                  setRefundTo("");
                }}
                className="block h-9 border border-border bg-background px-2 text-sm text-foreground"
                disabled={!chains.length}
              >
                {chains.map((c) => (
                  <option key={c} value={c}>
                    {chainName(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-foreground/55">
              <span>Token</span>
              <select
                value={origin?.assetId ?? ""}
                onChange={(e) => setAssetId(e.target.value)}
                className="block h-9 border border-border bg-background px-2 text-sm text-foreground"
                disabled={!assets.length}
              >
                {assets.map((a) => (
                  <option key={a.assetId} value={a.assetId}>
                    {a.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-foreground/55">
              <span>Receive (USDC)</span>
              <input
                value={amountUsd}
                onChange={(e) => setAmountUsd(e.target.value)}
                inputMode="decimal"
                className="block h-9 w-28 border border-border bg-background px-2 text-sm tabular-nums text-foreground"
              />
            </label>
          </div>

          <label className="block space-y-1 text-xs text-foreground/55">
            <span>
              Refund address on {origin ? chainName(origin.blockchain) : "the origin chain"}
              {origin?.evm ? " (defaults to your passkey wallet: same address on every EVM chain)" : ""}
            </span>
            <input
              value={refundTo}
              onChange={(e) => setRefundTo(e.target.value)}
              placeholder={origin?.evm ? (wallet.address ?? "") : "Your address on that chain"}
              className="block h-9 w-full border border-border bg-background px-2 font-mono text-xs text-foreground"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-foreground/65">
              {preview
                ? `You send ≈ ${preview.amountInFormatted} ${origin?.symbol} ($${Number(preview.amountInUsd).toFixed(2)}) · ~${Math.max(1, Math.round(preview.timeEstimate))}s`
                : origin && refundAddress
                  ? "Pricing…"
                  : "Pick a token and refund address"}
            </p>
            <Button
              type="button"
              onClick={() => void getDepositAddress()}
              disabled={busy || !origin || !amountAtomic || !refundAddress || !wallet.address}
            >
              {busy ? "Quoting…" : "Get deposit address"}
            </Button>
          </div>
        </section>
      ) : (
        <section className="space-y-5 border border-border px-5 py-5">
          <div className="space-y-1">
            <p className="text-xs text-foreground/45">
              Send exactly this on {origin ? chainName(origin.blockchain) : "the origin chain"}
            </p>
            <p className="text-lg font-medium tabular-nums">
              {quote.amountInFormatted} {origin?.symbol}
            </p>
            <p className="text-xs text-foreground/45">
              You receive {quote.amountOutFormatted} USDC on Monad
              {quote.deadline ? ` · quote valid until ${new Date(quote.deadline).toLocaleTimeString()}` : ""}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground/45">To this one-time deposit address</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all border border-border bg-muted/40 px-3 py-2 text-xs">
                {quote.depositAddress}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(quote.depositAddress ?? "")}
              >
                Copy
              </Button>
            </div>
            {quote.depositMemo ? (
              <p className="text-xs">
                Memo: <code>{quote.depositMemo}</code>
              </p>
            ) : null}
          </div>

          <ol className="space-y-2 text-sm">
            {STAGES.map((stage, i) => (
              <li key={stage} className="flex items-center gap-2">
                <span
                  className={
                    i < stageIndex || done
                      ? "size-2 rounded-full bg-emerald-500"
                      : i === stageIndex
                        ? "size-2 animate-pulse rounded-full bg-foreground"
                        : "size-2 rounded-full bg-foreground/20"
                  }
                />
                <span className={i <= stageIndex || done ? "" : "text-foreground/45"}>
                  {STAGE_LABEL[stage]}
                </span>
              </li>
            ))}
            {status?.status && !STAGES.includes(status.status as (typeof STAGES)[number]) ? (
              <li className="text-destructive">
                {STAGE_LABEL[status.status] ?? status.status}
                {status.swapDetails?.refundReason ? ` (${status.swapDetails.refundReason})` : ""}
              </li>
            ) : null}
          </ol>

          {!status?.status || status.status === "PENDING_DEPOSIT" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 space-y-1 text-xs text-foreground/55">
                <span>Already sent? Paste the tx hash to speed it up (optional)</span>
                <input
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  className="block h-8 w-full border border-border bg-background px-2 font-mono text-xs text-foreground"
                />
              </label>
              <Button type="button" size="sm" variant="outline" onClick={() => void reportTx()}>
                Report
              </Button>
            </div>
          ) : null}

          {arrival ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Alchemy saw {arrival.value} {arrival.asset} land in your wallet ({short(arrival.hash)})
            </p>
          ) : null}

          {status?.swapDetails?.destinationChainTxHashes?.length ? (
            <ul className="space-y-1 text-xs">
              {status.swapDetails.destinationChainTxHashes.map((t) => (
                <li key={t.hash}>
                  Monad delivery:{" "}
                  <a
                    href={t.explorerUrl || `https://monadscan.com/tx/${t.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono underline-offset-2 hover:underline"
                  >
                    {short(t.hash)}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {done ? (
              <Link href={returnTo}>
                <Button type="button">Back to your order</Button>
              </Link>
            ) : null}
            {status?.status && FINAL.has(status.status) ? (
              <Button type="button" variant="outline" onClick={reset}>
                New top-up
              </Button>
            ) : null}
          </div>
        </section>
      )}

      <p className="text-xs leading-relaxed text-foreground/45">
        Quotes and routing by Aurora Intents (NEAR Intents). If the swap cannot
        complete, funds go back to the refund address on the origin chain.
      </p>
    </main>
  );
}

export default function FundPage() {
  return (
    <Suspense fallback={<main className="px-6 py-10 text-sm text-foreground/50">Loading…</main>}>
      <FundInner />
    </Suspense>
  );
}
