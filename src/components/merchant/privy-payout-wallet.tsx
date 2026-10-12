"use client";

import {
  PrivyProvider,
  usePrivy,
  useSendTransaction,
  useSignMessage,
  useWallets,
} from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, getAddress, isAddress, parseUnits } from "viem";
import { Button } from "@/components/ui/button";
import { chainPreset } from "@/lib/chains";
import { config } from "@/lib/config";
import { buildMerchantAuthMessage, type MerchantAuthProof } from "@/lib/wallet/ethereum";

/**
 * Merchants get a payout wallet from Privy: sign in with email, Privy creates
 * an embedded wallet, the wallet signs the payout-binding proof, and later
 * sweeps received USDC out with Privy gas sponsorship. No seed phrase, no
 * extension, no raw private keys pasted into the page.
 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

const erc20Transfer = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function PayoutWalletInner({
  onBound,
  boundAddress,
}: {
  onBound: (proof: MerchantAuthProof) => Promise<void>;
  boundAddress: string | null;
}) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { sendTransaction } = useSendTransaction();
  const [busy, setBusy] = useState<"bind" | "sweep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [sweepTo, setSweepTo] = useState("");
  const [sweepAmount, setSweepAmount] = useState("");

  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === "privy"),
    [wallets],
  );
  const address = embedded?.address ? getAddress(embedded.address) : null;
  const isBound = Boolean(address && boundAddress && address.toLowerCase() === boundAddress.toLowerCase());

  const loadBalance = useCallback(async () => {
    if (!address) return;
    const data = (await fetch(`/api/wallet/balance?address=${address}`)
      .then((r) => r.json())
      .catch(() => null)) as { balance?: string } | null;
    if (data?.balance !== undefined) setBalance(data.balance);
  }, [address]);

  useEffect(() => {
    const timer = setTimeout(() => void loadBalance(), 0);
    return () => clearTimeout(timer);
  }, [loadBalance]);

  async function bind() {
    if (!address) return;
    setBusy("bind");
    setError(null);
    try {
      const message = buildMerchantAuthMessage(address);
      const { signature } = await signMessage(
        { message },
        { address, uiOptions: { title: "Prove you own this payout wallet" } },
      );
      await onBound({
        address,
        message,
        signature,
        network: config.network,
        authenticatedAt: new Date().toISOString(),
      });
      setNote(`Payout wallet ${short(address)} bound for ${config.chainLabel}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setBusy(null);
    }
  }

  async function sweep() {
    if (!address || !isAddress(sweepTo.trim())) {
      setError("Enter a valid destination address");
      return;
    }
    let value: bigint;
    try {
      value = parseUnits(sweepAmount.trim() || "0", config.tokenDecimals);
    } catch {
      setError("Enter an amount");
      return;
    }
    if (value <= BigInt(0)) {
      setError("Enter an amount");
      return;
    }
    setBusy("sweep");
    setError(null);
    try {
      const { hash } = await sendTransaction(
        {
          to: config.tokenAddress,
          chainId: config.chainId,
          data: encodeFunctionData({
            abi: erc20Transfer,
            functionName: "transfer",
            args: [getAddress(sweepTo.trim()), value],
          }),
        },
        {
          address,
          // Privy pays the gas when sponsorship is enabled for this chain in the dashboard.
          sponsor: process.env.NEXT_PUBLIC_PRIVY_SPONSOR_GAS === "1",
          uiOptions: { description: `Send ${sweepAmount} ${config.tokenSymbol} on ${config.chainLabel}` },
        },
      );
      setNote(`Sent. ${config.explorerBase}/tx/${hash}`);
      setSweepAmount("");
      void loadBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return <p className="text-xs text-muted-foreground">Loading Privy…</p>;

  if (!authenticated) {
    return (
      <div className="space-y-2">
        <Button type="button" onClick={login} className="h-9">
          Create a payout wallet with Privy
        </Button>
        <p className="text-xs text-muted-foreground">
          Email sign-in. Privy creates the wallet; you never handle a private key.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono">{address ? short(address) : "Creating wallet…"}</p>
          <p className="text-xs text-muted-foreground">
            Privy embedded wallet · {user?.email?.address ?? "signed in"} ·{" "}
            {balance ?? "…"} {config.tokenSymbol}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void bind()}
            disabled={!address || busy !== null || isBound}
          >
            {isBound ? "Bound" : busy === "bind" ? "Signing…" : "Use as payout wallet"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </div>

      {isBound ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">
            <span>Withdraw {config.tokenSymbol} to</span>
            <input
              value={sweepTo}
              onChange={(e) => setSweepTo(e.target.value)}
              placeholder="0x…"
              className="block h-8 w-full border border-border bg-background px-2 font-mono text-xs text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Amount</span>
            <input
              value={sweepAmount}
              onChange={(e) => setSweepAmount(e.target.value)}
              inputMode="decimal"
              className="block h-8 w-24 border border-border bg-background px-2 text-xs tabular-nums text-foreground"
            />
          </label>
          <Button type="button" size="sm" variant="outline" onClick={() => void sweep()} disabled={busy !== null}>
            {busy === "sweep" ? "Sending…" : "Withdraw"}
          </Button>
        </div>
      ) : null}

      {note ? <p className="break-all text-xs text-emerald-600 dark:text-emerald-400">{note}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function PrivyPayoutWallet(props: {
  onBound: (proof: MerchantAuthProof) => Promise<void>;
  boundAddress: string | null;
}) {
  const chain = useMemo(() => chainPreset(config.network).viemChain, []);
  if (!PRIVY_APP_ID) {
    return (
      <p className="text-xs text-muted-foreground">
        Set NEXT_PUBLIC_PRIVY_APP_ID to create payout wallets with Privy.
      </p>
    );
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "passkey"],
        embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
        defaultChain: chain,
        supportedChains: [chain],
        appearance: { theme: "light", walletChainType: "ethereum-only" },
      }}
    >
      <PayoutWalletInner {...props} />
    </PrivyProvider>
  );
}
