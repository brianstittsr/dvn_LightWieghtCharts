"use client";

import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { DayPnl, DayTrade } from "@/app/api/alpaca/pnl/route";
import { PnlDayDetail } from "@/components/pnl-day-detail";
import {
  getJournaledDates,
  getServerJournaledDates,
  markJournaled,
  subscribeJournals,
} from "@/lib/journal-store";
import { cn, signed, usd } from "@/lib/utils";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type AssetFilter = "all" | "stock" | "option";
const ASSET_FILTERS: { key: AssetFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "stock", label: "Stocks" },
  { key: "option", label: "Options" },
];

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border-l-2 border-neutral-700 pl-3">
      <span className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</span>
      <span className="mt-0.5 font-mono text-[11px] text-neutral-200">{children}</span>
    </div>
  );
}

/** Recompute a day's aggregates from a subset of its fills (asset filter). */
function filteredDay(date: string, details: DayTrade[]): DayPnl {
  const out: DayPnl = {
    date,
    pnl: 0,
    trades: details.length,
    wins: 0,
    losses: 0,
    opens: 0,
    details,
  };
  for (const t of details) {
    out.pnl += t.realized;
    if (t.closedQty === 0) {
      out.opens += 1;
    } else if (t.realized > 0) {
      out.wins += 1;
    } else if (t.realized < 0) {
      out.losses += 1;
    }
  }
  return out;
}

interface WeekAgg {
  label: string;
  days: number;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
}

/** TradeZella-style monthly P&L calendar fed by Alpaca account history. */
export function PnlCalendar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [days, setDays] = useState<DayPnl[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [hideAmounts, setHideAmounts] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const journaled = useSyncExternalStore(
    subscribeJournals,
    getJournaledDates,
    getServerJournaledDates,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || days !== null) return;
    let cancelled = false;
    fetch("/api/alpaca/pnl")
      .then(async (r) => {
        const b = (await r.json()) as { data?: { days: DayPnl[] }; error?: string };
        if (!r.ok || !b.data) throw new Error(b.error ?? "Failed to load");
        if (!cancelled) setDays(b.data.days);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load P&L");
      });
    return () => {
      cancelled = true;
    };
  }, [open, days]);

  /** Days re-aggregated for the active asset filter. */
  const filteredDays = useMemo<DayPnl[]>(() => {
    if (!days) return null as unknown as DayPnl[];
    if (assetFilter === "all") return days;
    return days.map((d) => filteredDay(d.date, d.details.filter((t) => t.assetClass === assetFilter)));
  }, [days, assetFilter]);

  const byDate = useMemo(() => {
    const m = new Map<string, DayPnl>();
    for (const d of filteredDays ?? []) m.set(d.date, d);
    return m;
  }, [filteredDays]);

  /** Monthly totals keyed "YYYY-MM" for the month strip. */
  const monthTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of filteredDays ?? []) {
      const k = d.date.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + d.pnl);
    }
    return m;
  }, [filteredDays]);

  const fmt = (v: number): string => (hideAmounts ? "•••" : usd(v));
  const fmtSigned = (v: number): string => (hideAmounts ? "•••" : signed(v));

  async function copySummary(stats: {
    label: string;
    monthPnl: number;
    greenDays: number;
    redDays: number;
    winRate: number;
    closedCount: number;
  }): Promise<void> {
    const pnlTxt = hideAmounts ? "•••" : signed(stats.monthPnl);
    const wr = stats.closedCount > 0 ? `${stats.winRate.toFixed(0)}% win rate` : "no closed trades";
    const filterTag = assetFilter === "all" ? "" : ` (${assetFilter === "stock" ? "stocks" : "options"} only)`;
    const text = `${stats.label}${filterTag} — P&L ${pnlTxt} · ${stats.greenDays} green / ${stats.redDays} red days · ${wr}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy summary:", text);
    }
  }

  if (!open) return null;

  // Build the 6-week Monday-start grid for the selected month.
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (DayPnl & { inMonth: boolean })[] = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startOffset + 1;
    const d = new Date(year, month, dayNum);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    const src = byDate.get(key);
    cells.push({
      date: key,
      inMonth: dayNum >= 1 && dayNum <= daysInMonth,
      pnl: src?.pnl ?? 0,
      trades: src?.trades ?? 0,
      wins: src?.wins ?? 0,
      losses: src?.losses ?? 0,
      opens: src?.opens ?? 0,
      details: src?.details ?? [],
    });
  }
  const weeks: { cells: typeof cells; agg: WeekAgg }[] = [];
  for (let w = 0; w < 6; w++) {
    const row = cells.slice(w * 7, w * 7 + 7);
    const inMonth = row.filter((c) => c.inMonth);
    if (inMonth.length === 0) continue;
    const traded = inMonth.filter((c) => c.trades > 0 || c.pnl !== 0);
    weeks.push({
      cells: row,
      agg: {
        label: `${inMonth[0].date.slice(5).replace("-", " ")} – ${inMonth[inMonth.length - 1].date
          .slice(5)
          .replace("-", " ")}`,
        days: traded.length,
        trades: traded.reduce((s, c) => s + c.trades, 0),
        wins: traded.reduce((s, c) => s + c.wins, 0),
        losses: traded.reduce((s, c) => s + c.losses, 0),
        pnl: inMonth.reduce((s, c) => s + c.pnl, 0),
      },
    });
  }

  // Month stats strip
  const active = cells.filter((c) => c.inMonth && (c.trades > 0 || c.pnl !== 0));
  const greenDays = active.filter((c) => c.pnl > 0).length;
  const redDays = active.filter((c) => c.pnl < 0).length;
  const totalTrades = active.reduce((s, c) => s + c.trades, 0);
  const totalWins = active.reduce((s, c) => s + c.wins, 0);
  const totalLosses = active.reduce((s, c) => s + c.losses, 0);
  const monthPnl = active.reduce((s, c) => s + c.pnl, 0);
  const closedCount = totalWins + totalLosses;
  const winRate = closedCount > 0 ? (totalWins / closedCount) * 100 : 0;
  const best = active.length ? active.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const worst = active.length ? active.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;
  const busiest = active.length ? active.reduce((a, b) => (b.trades > a.trades ? b : a)) : null;
  // Heatmap intensity: cell alpha scales with |pnl| vs the month's biggest day.
  const maxAbsPnl = active.reduce((m, c) => Math.max(m, Math.abs(c.pnl)), 0);
  const cellBg = (pnl: number): React.CSSProperties | undefined => {
    if (pnl === 0 || maxAbsPnl === 0) return undefined;
    const t = Math.min(Math.abs(pnl) / maxAbsPnl, 1);
    const alpha = 0.18 + t * 0.55;
    return {
      backgroundColor: pnl > 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`,
    };
  };
  const dayLabel = (d: DayPnl) =>
    `${MONTHS[Number(d.date.slice(5, 7)) - 1]} ${Number(d.date.slice(8))}`;

  const monthTitle = new Date(year, month, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });

  // Drill-down day resolved from the filtered map so it matches the cell.
  const selectedDay: DayPnl | null = selectedDate
    ? (byDate.get(selectedDate) ?? {
        date: selectedDate,
        pnl: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        opens: 0,
        details: [],
      })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-neutral-800 bg-[#0d0f13] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-neutral-100">P&amp;L Calendar</h2>
            <p className="text-[10px] text-neutral-500">Realized + unrealized equity P&amp;L per day</p>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Asset filter */}
            <div className="flex overflow-hidden rounded border border-neutral-700">
              {ASSET_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setAssetFilter(f.key)}
                  aria-pressed={assetFilter === f.key}
                  className={cn(
                    "px-2 py-1 text-[10px] font-semibold",
                    assetFilter === f.key
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() =>
                copySummary({ label: monthTitle, monthPnl, greenDays, redDays, winRate, closedCount })
              }
              className="rounded bg-neutral-800 px-2 py-1 text-[10px] font-medium text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
              title="Copy a plain-text month summary"
            >
              {copied ? "Copied!" : "Share"}
            </button>
            <button
              onClick={() => setHideAmounts((h) => !h)}
              aria-pressed={hideAmounts}
              title={hideAmounts ? "Show amounts" : "Hide amounts"}
              className={cn(
                "rounded px-2 py-1 text-[10px] font-medium",
                hideAmounts
                  ? "bg-amber-800/60 text-amber-200"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
              )}
            >
              {hideAmounts ? "•••" : "👁"}
            </button>
            <button onClick={onClose} className="text-xl text-neutral-500 hover:text-neutral-200" aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {/* Year + month strip */}
        <div className="mb-3 flex items-center gap-1 overflow-x-auto rounded border border-neutral-800 p-1">
          <button onClick={() => setYear(year - 1)} className="px-1.5 text-neutral-400 hover:text-neutral-100">‹</button>
          <span className="mr-1 font-mono text-[11px] text-neutral-400">{year}</span>
          {MONTHS.map((m, i) => {
            const total = monthTotals.get(`${year}-${String(i + 1).padStart(2, "0")}`);
            const sel = i === month;
            return (
              <button
                key={m}
                onClick={() => setMonth(i)}
                className={`min-w-14 rounded px-2 py-1 text-center ${
                  sel
                    ? "bg-green-900/40 outline outline-1 outline-green-500/60"
                    : total == null
                      ? "hover:bg-neutral-800"
                      : total >= 0
                        ? "bg-green-900/20 hover:bg-green-900/30"
                        : "bg-red-900/20 hover:bg-red-900/30"
                }`}
              >
                <div className={`text-[9px] font-semibold ${sel ? "text-neutral-100" : "text-neutral-400"}`}>
                  {m}
                </div>
                <div
                  className={`font-mono text-[10px] ${
                    total == null ? "text-neutral-600" : total >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {total == null ? "—" : fmtSigned(total)}
                </div>
              </button>
            );
          })}
          <span className="ml-1 font-mono text-[11px] text-neutral-400">{year + 1}</span>
          <button onClick={() => setYear(year + 1)} className="px-1.5 text-neutral-400 hover:text-neutral-100">›</button>
        </div>

        {error && <div className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
        {!days && !error && <div className="py-16 text-center text-xs text-neutral-500">Loading account history…</div>}

        {days && (
          <>
            {/* Stats row */}
            <div className="mb-3 grid grid-cols-4 gap-3 lg:grid-cols-8">
              <Stat label="Monthly P&L">
                <span className={monthPnl >= 0 ? "text-green-400" : "text-red-400"}>{fmtSigned(monthPnl)}</span>
              </Stat>
              <Stat label="Trading days">
                {active.length}d · <span className="text-green-400">{greenDays} green</span> ·{" "}
                <span className="text-red-400">{redDays} red</span>
              </Stat>
              <Stat label="Trades">
                {totalTrades} total · <span className="text-green-400">{totalWins}W</span> ·{" "}
                <span className="text-red-400">{totalLosses}L</span>
              </Stat>
              <Stat label="Win rate">
                <span className={winRate >= 50 ? "text-green-400" : "text-red-400"}>
                  {closedCount > 0 ? `${winRate.toFixed(0)}%` : "—"}
                </span>
              </Stat>
              <Stat label="Best day">
                {best && best.pnl > 0 ? (
                  <span className="text-green-400">{fmtSigned(best.pnl)} · {dayLabel(best)}</span>
                ) : "—"}
              </Stat>
              <Stat label="Worst day">
                {worst && worst.pnl < 0 ? (
                  <span className="text-red-400">{fmtSigned(worst.pnl)} · {dayLabel(worst)}</span>
                ) : "—"}
              </Stat>
              <Stat label="Most active day">
                {busiest && busiest.trades > 0 ? `${busiest.trades} trades · ${dayLabel(busiest)}` : "—"}
              </Stat>
              <Stat label="Avg / day">
                <span className={monthPnl >= 0 ? "text-green-400" : "text-red-400"}>
                  {active.length ? fmt(monthPnl / active.length) : "—"}
                </span>
              </Stat>
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-8 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="pb-1 text-center text-[10px] font-medium text-neutral-500">
                  {d}
                </div>
              ))}
              <div className="pb-1 text-center text-[10px] font-medium text-neutral-500">Week</div>
              {weeks.map((w) => (
                <Fragment key={w.agg.label}>
                  {w.cells.map((c) => {
                    const hasPnl = c.pnl !== 0;
                    const textTone = hasPnl
                      ? c.pnl > 0
                        ? "text-green-300"
                        : "text-red-300"
                      : "bg-neutral-900/40 text-neutral-400";
                    return (
                      <div
                        key={c.date}
                        role={c.inMonth ? "button" : undefined}
                        tabIndex={c.inMonth ? 0 : undefined}
                        onClick={c.inMonth ? () => setSelectedDate(c.date) : undefined}
                        onKeyDown={
                          c.inMonth
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") setSelectedDate(c.date);
                              }
                            : undefined
                        }
                        style={cellBg(c.pnl)}
                        className={`min-h-16 rounded p-1.5 ${textTone} ${
                          c.inMonth ? "cursor-pointer hover:ring-1 hover:ring-neutral-500" : "opacity-30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-0.5">
                          <span className="text-[10px] font-semibold text-neutral-300">
                            {Number(c.date.slice(8))}
                          </span>
                          <span className="flex items-center gap-0.5">
                            {journaled.has(c.date) && (
                              <span className="text-[9px]" title="Journal entry saved">�</span>
                            )}
                            {c.wins > 0 && (
                              <span className="rounded bg-green-800/60 px-0.5 text-[8px] font-bold text-green-200">
                                {c.wins}W
                              </span>
                            )}
                            {c.losses > 0 && (
                              <span className="rounded bg-red-800/60 px-0.5 text-[8px] font-bold text-red-200">
                                {c.losses}L
                              </span>
                            )}
                            {c.opens > 0 && (
                              <span className="rounded bg-neutral-700/80 px-0.5 text-[8px] font-bold text-neutral-300">
                                {c.opens}O
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] font-semibold">
                          {hasPnl || c.trades > 0 ? fmt(c.pnl) : ""}
                        </div>
                        {c.trades > 0 && (
                          <div className="text-[9px] text-neutral-400">
                            {c.trades} trade{c.trades === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="min-h-16 rounded bg-neutral-900/60 p-1.5 text-[9px]">
                    <div className="text-neutral-500">{w.agg.label}</div>
                    {w.agg.trades > 0 ? (
                      <>
                        <div className={`mt-0.5 font-mono text-[11px] font-semibold ${w.agg.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {fmtSigned(w.agg.pnl)}
                        </div>
                        <div className="text-neutral-400">
                          {w.agg.days} days · {w.agg.trades} trades
                        </div>
                        <div>
                          <span className="text-green-400">{w.agg.wins} Win</span>
                          <span className="text-neutral-500"> · </span>
                          <span className="text-red-400">{w.agg.losses} Loss</span>
                        </div>
                        {w.agg.wins + w.agg.losses > 0 && (
                          <div className="text-green-400">
                            {((w.agg.wins / (w.agg.wins + w.agg.losses)) * 100).toFixed(0)}%
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-1 text-neutral-600">No trades</div>
                    )}
                  </div>
                </Fragment>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedDay && (
        <PnlDayDetail
          key={selectedDay.date}
          day={selectedDay}
          hideAmounts={hideAmounts}
          onClose={() => setSelectedDate(null)}
          onJournalSaved={markJournaled}
        />
      )}
    </div>
  );
}
