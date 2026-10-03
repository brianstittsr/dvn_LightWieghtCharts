"use client";

import { signOut } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChartPane } from "@/components/chart-pane";
import { PositionsBar } from "@/components/positions-bar";
import { MarketStatus } from "@/components/market-status";
import { PnlCalendar } from "@/components/pnl-calendar";
import { EconomicCalendar } from "@/components/economic-calendar";
import { FuturesBots } from "@/components/futures-bots";
import { FuturesTicket } from "@/components/futures-ticket";
import { PlatformsDialog } from "@/components/platforms-dialog";
import { CHART_COUNTS, useChartCount } from "@/hooks/use-chart-count";
import { firebaseConfigured, getClientAuth } from "@/lib/firebase";
import { DEFAULT_PANE_SYMBOLS } from "@/lib/symbols";
import { cn } from "@/lib/utils";

/** Cleanest grid shape per pane count: 1=1×1, 2=2×1, 4=2×2, 6=3×2, 8=4×2. */
const GRID: Record<number, string> = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1",
  4: "grid-cols-1 grid-rows-4 sm:grid-cols-2 sm:grid-rows-2",
  6: "grid-cols-1 grid-rows-6 sm:grid-cols-2 sm:grid-rows-3 lg:grid-cols-3 lg:grid-rows-2",
  8: "grid-cols-1 grid-rows-8 sm:grid-cols-2 sm:grid-rows-4 lg:grid-cols-4 lg:grid-rows-2",
};

export function Dashboard() {
  const [count, setCount] = useChartCount();
  const [calOpen, setCalOpen] = useState(false);
  const [econOpen, setEconOpen] = useState(false);
  const [platOpen, setPlatOpen] = useState(false);
  const [futOpen, setFutOpen] = useState(false);
  const [botsOpen, setBotsOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Deep-link from the scanners: /?symbol=AMD loads it into pane 0.
  const urlSymbol = useSearchParams().get("symbol")?.toUpperCase() ?? null;

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) return;
    return auth.onAuthStateChanged((u) => setUserEmail(u?.email ?? null));
  }, []);

  return (
    <div className="flex h-screen flex-col gap-2 bg-neutral-950 p-2">
      <header className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-sm font-semibold text-neutral-200">Live Charts</h1>
        <div className="flex items-center gap-1" role="group" aria-label="Number of charts">
          <span className="mr-1 text-xs text-neutral-500">Number of charts:</span>
          {CHART_COUNTS.map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                count === n
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCalOpen(true)}
          title="P&L calendar"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          📅 P&L
        </button>
        <button
          onClick={() => setEconOpen(true)}
          title="Economic calendar"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          📊 Econ
        </button>
        <button
          onClick={() => setPlatOpen(true)}
          title="Connected trading platforms"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          🔌 Platforms
        </button>
        <button
          onClick={() => setFutOpen(true)}
          title="Futures order ticket (TopStep / Apex)"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          ⚡ Futures
        </button>
        <button
          onClick={() => setBotsOpen(true)}
          title="Futures trading bots"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          🤖 Bots
        </button>
        <Link
          href="/prop-firm"
          title="Prop firm challenge calculator"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          🧮 Prop Firm
        </Link>
        <Link
          href="/scanner"
          title="Stock scanners — gappers, setups, alerts"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          📡 Scanner
        </Link>
        <Link
          href="/admin"
          title="Admin — accounts & settings"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          ⚙ Admin
        </Link>
        {firebaseConfigured && userEmail && (
          <>
            <span className="text-xs text-neutral-500" title="Signed in as">
              {userEmail}
            </span>
            <button
              onClick={() => void signOut(getClientAuth()!)}
              title="Sign out"
              className="rounded bg-red-900/60 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-800/70"
            >
              Sign out
            </button>
          </>
        )}
        <MarketStatus />
      </header>
      <main className={cn("grid min-h-0 flex-1 gap-2", GRID[count])}>
        {Array.from({ length: count }, (_, i) => (
          <ChartPane
            key={i === 0 && urlSymbol ? `pane-0-${urlSymbol}` : `pane-${i}`}
            paneId={`pane-${i}`}
            defaultSymbol={
              i === 0 && urlSymbol
                ? urlSymbol
                : DEFAULT_PANE_SYMBOLS[i % DEFAULT_PANE_SYMBOLS.length]
            }
          />
        ))}
      </main>
      <PositionsBar />
      <PnlCalendar open={calOpen} onClose={() => setCalOpen(false)} />
      <EconomicCalendar open={econOpen} onClose={() => setEconOpen(false)} />
      <PlatformsDialog open={platOpen} onClose={() => setPlatOpen(false)} />
      <FuturesTicket open={futOpen} onClose={() => setFutOpen(false)} />
      <FuturesBots open={botsOpen} onClose={() => setBotsOpen(false)} />
    </div>
  );
}
