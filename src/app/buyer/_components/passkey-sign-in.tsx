"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passkeysSupported } from "@/lib/mera/passkey-account";
import { config } from "@/lib/config";
import { usePasskeyWallet } from "./passkey-wallet-provider";

const noop = () => () => {};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The only buyer sign-in: one passkey ceremony, no email, no seed phrase.
 * `intent` just decides which button leads.
 */
export function PasskeySignIn({ intent }: { intent: "sign-in" | "create" }) {
  const router = useRouter();
  const wallet = usePasskeyWallet();
  const [label, setLabel] = useState("");
  const supported = useSyncExternalStore(noop, passkeysSupported, () => true);

  async function go(action: "create" | "unlock") {
    try {
      if (action === "create") await wallet.create(label);
      else await wallet.unlock();
      router.replace("/buyer");
    } catch {
      // wallet.error carries the message
    }
  }

  const create = (
    <Button
      type="button"
      disabled={wallet.busy || !supported}
      onClick={() => void go("create")}
      variant={intent === "create" ? "default" : "outline"}
      className="h-11 w-full"
    >
      {wallet.busy ? "Waiting for passkey…" : "Create account with a passkey"}
    </Button>
  );
  const unlock = (
    <Button
      type="button"
      disabled={wallet.busy || !supported}
      onClick={() => void go("unlock")}
      variant={intent === "sign-in" ? "default" : "outline"}
      className="h-11 w-full"
    >
      {wallet.hint
        ? `Continue as ${short(wallet.hint.address)}`
        : "Sign in with a passkey"}
    </Button>
  );

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 pt-24 pb-12">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Shop · Passkey account
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {intent === "create" ? "Start shopping" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-foreground/70">
          Your passkey is your wallet on {config.chainLabel}. No seed phrase, no
          extension, no email. The same passkey opens the same account on any
          device.
        </p>
      </div>

      {wallet.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {wallet.error}
        </p>
      ) : null}
      {!supported ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-foreground/70">
          Passkeys need a secure page (HTTPS or localhost) and a browser with
          WebAuthn.
        </p>
      ) : null}

      {intent === "create" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <label htmlFor="label" className="text-sm font-medium">
              Name on the passkey <span className="text-foreground/45">(optional)</span>
            </label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Borneo shopper"
              className="h-10"
            />
          </div>
          {create}
          {unlock}
        </div>
      ) : (
        <div className="space-y-3">
          {unlock}
          {create}
        </div>
      )}

      <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-3 text-xs leading-relaxed text-foreground/65">
        After one prompt, the shopping agent can pay up to $25 per order (and
        $100 per session) without asking again, for 30 minutes or until 10
        idle minutes pass. Anything bigger asks for your passkey again.
      </div>

      {wallet.hint ? (
        <button
          type="button"
          onClick={wallet.forget}
          className="self-start text-xs text-foreground/50 underline-offset-2 hover:underline"
        >
          Use a different passkey on this device
        </button>
      ) : null}

      <p className="text-xs text-foreground/45">
        Not shopping?{" "}
        <Link
          href="/merchant/login"
          className="text-foreground/70 underline-offset-2 hover:underline"
        >
          Sell on Borneo
        </Link>
      </p>
    </main>
  );
}
