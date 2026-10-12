import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createPublicClient, http } from "viem";
import { SiteHeader } from "@/components/site-header";
import { chainPreset, normalizeNetwork } from "@/lib/chains";
import { chainSettings } from "@/lib/config";

/** Chain settings plus a viem client for a `[chainId]` route segment. */
export function chainFromParam(raw: string) {
  const network = normalizeNetwork(raw);
  if (!network) notFound();
  const chain = chainSettings(network);
  const client = createPublicClient({
    chain: chainPreset(network).viemChain,
    transport: http(chain.rpcUrl),
  });
  return { chain, client };
}

export function ExplorerShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-[960px] px-6 pt-24 pb-12">
        <p className="text-sm text-foreground/60">{subtitle}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <dl className="mt-6 divide-y divide-border border border-border">
          {children}
        </dl>
        <p className="mt-4 text-xs text-foreground/50">
          Read live from the chain&apos;s JSON-RPC. No public explorer indexes this
          network yet.
        </p>
      </main>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-foreground/60">{label}</dt>
      <dd className="break-all font-mono text-sm text-foreground">{children}</dd>
    </div>
  );
}
