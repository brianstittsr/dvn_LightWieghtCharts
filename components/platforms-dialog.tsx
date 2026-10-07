"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { usd } from "@/lib/utils";
import type { PlatformStatus } from "@/app/api/platforms/route";
import { PLATFORMS, type PlatformDef } from "@/lib/platforms/registry";

const KIND_LABEL: Record<PlatformDef["kind"], string> = {
  broker: "Broker",
  prop: "Prop firm",
  desktop: "Desktop",
};

function Card({ p, status }: { p: PlatformDef; status: PlatformStatus | undefined }) {
  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;
  const dot = connected ? "bg-green-400" : configured ? "bg-amber-400" : "bg-neutral-600";
  const stateLabel = connected ? "Connected" : configured ? "Configured" : "Not connected";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-sm font-semibold text-neutral-100">{p.name}</span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
            {KIND_LABEL[p.kind]}
          </span>
        </div>
        <span className={`text-[10px] font-medium ${connected ? "text-green-400" : "text-neutral-500"}`}>
          {stateLabel}
        </span>
      </div>

      {status?.account && (
        <div className="mt-2 font-mono text-xs text-neutral-300">
          {status.account.label}
          {status.account.balance !== undefined && (
            <span className="ml-2 text-green-400">{usd(status.account.balance)}</span>
          )}
        </div>
      )}
      {status?.note && <div className="mt-1.5 text-[10px] text-amber-400/90">{status.note}</div>}

      <div className="mt-2 flex flex-wrap gap-1">
        {p.capabilities.map((c) => (
          <span key={c} className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400">
            {c}
          </span>
        ))}
      </div>

      {!connected && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-neutral-500 hover:text-neutral-300">
            Setup
          </summary>
          <p className="mt-1 text-[10px] leading-snug text-neutral-400">{p.setup}</p>
          {p.envVars.length > 0 && (
            <div className="mt-1 space-y-0.5 font-mono text-[9px] text-neutral-500">
              {p.envVars.map((v) => (
                <div key={v}>{v}</div>
              ))}
            </div>
          )}
        </details>
      )}
    </div>
  );
}

/** Broker/prop-platform connection status panel. */
export function PlatformsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [statuses, setStatuses] = useState<PlatformStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    authFetch("/api/platforms")
      .then(async (r) => {
        const b = (await r.json()) as { data?: { platforms: PlatformStatus[] }; error?: string };
        if (!r.ok || !b.data) throw new Error(b.error ?? "Failed to load");
        if (!cancelled) setStatuses(b.data.platforms);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-neutral-800 bg-[#0d0f13] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-neutral-100">Trading Platforms</h2>
            <p className="text-[10px] text-neutral-500">
              Connected brokers &amp; prop accounts — credentials via Admin → Trading
              accounts (per-user) with .env.local fallback
            </p>
          </div>
          <button onClick={onClose} className="text-xl text-neutral-500 hover:text-neutral-200" aria-label="Close">
            ×
          </button>
        </div>

        {error && <div className="mb-3 rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
        {!statuses && !error && (
          <div className="py-12 text-center text-xs text-neutral-500">Probing connections…</div>
        )}

        <div className="space-y-2">
          {PLATFORMS.map((p) => (
            <Card key={p.id} p={p} status={statuses?.find((s) => s.id === p.id)} />
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-snug text-neutral-600">
          Note: TopStep/Apex connect through the ProjectX gateway (username + API key).
          FOREX.com uses the GAIN Capital TradingAPI (username + password + AppKey).
          NinjaTrader has no cloud API — it needs a local NT8 bridge. Schwab requires
          a registered OAuth app. Connected platforms surface account balances here.
        </p>
      </div>
    </div>
  );
}
