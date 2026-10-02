"use client";

import { useState } from "react";
import { ChartPane } from "@/components/chart-pane";
import { PositionsBar } from "@/components/positions-bar";
import { MarketStatus } from "@/components/market-status";
import { PnlCalendar } from "@/components/pnl-calendar";
import { EconomicCalendar } from "@/components/economic-calendar";
import { PlatformsDialog } from "@/components/platforms-dialog";
import { CHART_COUNTS, useChartCount } from "@/hooks/use-chart-count";
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
        <a
          href="/admin"
          title="Admin — accounts & settings"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          ⚙ Admin
        </a>
        <MarketStatus />
      </header>
      <main className={cn("grid min-h-0 flex-1 gap-2", GRID[count])}>
        {Array.from({ length: count }, (_, i) => (
          <ChartPane
            key={`pane-${i}`}
            paneId={`pane-${i}`}
            defaultSymbol={DEFAULT_PANE_SYMBOLS[i % DEFAULT_PANE_SYMBOLS.length]}
          />
        ))}
      </main>
      <PositionsBar />
      <PnlCalendar open={calOpen} onClose={() => setCalOpen(false)} />
      <EconomicCalendar open={econOpen} onClose={() => setEconOpen(false)} />
      <PlatformsDialog open={platOpen} onClose={() => setPlatOpen(false)} />
    </div>
  );
}
