"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Clock {
  is_open: boolean;
  next_open: string;
  next_close: string;
}

function sessionOpen(now: Date, startUtcH: number, endUtcH: number): boolean {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  return startUtcH <= endUtcH ? h >= startUtcH && h < endUtcH : h >= startUtcH || h < endUtcH;
}

/** NYSE regular hours fallback if the Alpaca clock is unavailable. */
function usMarketOpenFallback(now: Date): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function Chip({ label, open, title }: { label: string; open: boolean; title?: string }) {
  return (
    <span
      title={title}
      className="flex items-center gap-1.5 rounded bg-neutral-800/70 px-2 py-0.5 text-[10px] font-medium text-neutral-300"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", open ? "bg-green-400" : "bg-neutral-600")} />
      {label}
      <span className={open ? "text-green-400" : "text-neutral-500"}>{open ? "open" : "closed"}</span>
    </span>
  );
}

/** Header chips showing which markets/sessions are currently open. */
export function MarketStatus() {
  const [now, setNow] = useState<Date>(() => new Date());
  const [usOpen, setUsOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/alpaca/clock");
        const body = (await res.json()) as { data?: Clock };
        if (!cancelled) setUsOpen(body.data?.is_open ?? null);
      } catch {
        if (!cancelled) setUsOpen(null);
      }
    }
    poll();
    const t = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="ml-auto flex items-center gap-1.5" aria-label="Market status">
      <Chip label="Crypto" open title="Hyperliquid — trades 24/7" />
      <Chip
        label="US Stocks"
        open={usOpen ?? usMarketOpenFallback(now)}
        title="NYSE/Nasdaq regular hours (Alpaca clock)"
      />
      <Chip label="Asia" open={sessionOpen(now, 0, 8)} title="Asia session 00:00–08:00 UTC" />
      <Chip label="London" open={sessionOpen(now, 7, 16)} title="London session 07:00–16:00 UTC" />
    </div>
  );
}
