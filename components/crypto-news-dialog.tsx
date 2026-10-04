"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { CryptoNewsItem } from "@/lib/crypto-news";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const SOURCE_COLORS: Record<string, string> = {
  CoinDesk: "bg-blue-900/60 text-blue-200",
  CoinTelegraph: "bg-teal-900/60 text-teal-200",
  Decrypt: "bg-purple-900/60 text-purple-200",
};

/** Crypto news feed for a coin — merged CoinDesk/CoinTelegraph/Decrypt RSS. */
export function CryptoNewsDialog({
  symbol,
  onClose,
}: {
  symbol: string;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<"coin" | "all">("coin");
  const [reload, setReload] = useState(0);
  const [items, setItems] = useState<CryptoNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void authFetch(
      `/api/crypto-news${scope === "coin" ? `?symbol=${encodeURIComponent(symbol)}` : ""}`,
    )
      .then(async (res) => {
        const d = (await res.json()) as {
          data?: { items?: CryptoNewsItem[] };
          error?: string;
        };
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
        if (alive) {
          setItems(d.data?.items ?? []);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load news");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [scope, symbol, reload]);

  const refresh = (): void => {
    setLoading(true);
    setReload((r) => r + 1);
  };
  const switchScope = (s: "coin" | "all"): void => {
    if (s === scope) return;
    setLoading(true);
    setScope(s);
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-neutral-700 bg-[#131722] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-bold">📰 Crypto News</h2>
          <div className="flex rounded bg-neutral-900 p-0.5">
            {(
              [
                ["coin", symbol],
                ["all", "All crypto"],
              ] as const
            ).map(([s, label]) => (
              <button
                key={s}
                onClick={() => switchScope(s)}
                className={cn(
                  "rounded px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                  scope === s ? "bg-[#2962ff] text-white" : "text-neutral-400 hover:text-neutral-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            title="Refresh"
            className="ml-auto rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            ↻
          </button>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && items.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-500">Loading feeds…</p>
          ) : error ? (
            <p className="py-8 text-center text-xs text-red-400">{error}</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-xs text-neutral-500">
              No {scope === "coin" ? `${symbol}-specific ` : ""}headlines right now — try
              &ldquo;All crypto&rdquo;.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((n, i) => (
                <li key={i}>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg border border-neutral-800 bg-[#1a1f2b] p-2.5 transition-colors hover:border-[#2962ff]/50 hover:bg-[#1e2533]"
                  >
                    <div className="mb-1 flex items-center gap-2 text-[10px]">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 font-semibold",
                          SOURCE_COLORS[n.source] ?? "bg-neutral-800 text-neutral-300",
                        )}
                      >
                        {n.source}
                      </span>
                      <span className="text-neutral-500">{timeAgo(n.publishedAt)} ago</span>
                      {n.coins.length > 0 && (
                        <span className="ml-auto flex gap-1">
                          {n.coins.slice(0, 4).map((c) => (
                            <span key={c} className="rounded bg-neutral-800 px-1 text-[9px] text-amber-200">
                              {c}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold leading-snug text-neutral-100">
                      {n.title}
                    </p>
                    {n.snippet && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-neutral-400">
                        {n.snippet}
                      </p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
