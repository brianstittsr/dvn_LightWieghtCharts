"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SimAccountState, SimPerformance, SimRoundTrip } from "@/lib/sim-account";
import { simPerformance, extractRoundTrips, saveJournalNote, loadJournalNote } from "@/lib/sim-account";

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col border-l-2 border-neutral-700 pl-3", className)}>
      <span className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</span>
      <span className="mt-0.5 font-mono text-[11px] text-neutral-200">{children}</span>
    </div>
  );
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface SimPerformanceDialogProps {
  open: boolean;
  onClose: () => void;
  simAccount: SimAccountState;
}

export function SimPerformanceDialog({ open, onClose, simAccount }: SimPerformanceDialogProps) {
  const [tab, setTab] = useState<"overview" | "trades" | "journal">("overview");
  const perf = useMemo(() => simPerformance(simAccount), [simAccount]);
  const trips = useMemo(() => extractRoundTrips(simAccount), [simAccount]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#2a2e39] bg-[#131722] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Performance Analytics</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white" aria-label="Close">✕</button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1">
          {(["overview", "trades", "journal"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded px-3 py-1 text-[11px] font-semibold capitalize",
                tab === t ? "bg-blue-700 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab perf={perf} simAccount={simAccount} />}
        {tab === "trades" && <TradesTab trips={trips} />}
        {tab === "journal" && <JournalTab trips={trips} />}
      </div>
    </div>
  );
}

function OverviewTab({ perf, simAccount }: { perf: SimPerformance; simAccount: SimAccountState }) {
  const totalPnl = simAccount.balance - simAccount.startBalance;

  return (
    <div className="space-y-4">
      {/* Key metrics */}
      <div className="flex flex-wrap gap-4">
        <Stat label="Total Trades">{perf.totalTrades}</Stat>
        <Stat label="Win Rate">
          <span className={perf.winRate >= 50 ? "text-green-400" : "text-red-400"}>
            {perf.winRate.toFixed(1)}%
          </span>
        </Stat>
        <Stat label="Profit Factor">
          <span className={perf.profitFactor >= 1 ? "text-green-400" : "text-red-400"}>
            {perf.profitFactor === Infinity ? "∞" : perf.profitFactor.toFixed(2)}
          </span>
        </Stat>
        <Stat label="Expectancy">
          <span className={perf.expectancy >= 0 ? "text-green-400" : "text-red-400"}>
            {usd(perf.expectancy)}
          </span>
        </Stat>
        <Stat label="Avg R:R">{perf.avgRR.toFixed(2)}</Stat>
        <Stat label="Total P&L">
          <span className={totalPnl >= 0 ? "text-green-400" : "text-red-400"}>{usd(totalPnl)}</span>
        </Stat>
      </div>

      {/* Win/Loss breakdown */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
          <p className="text-[10px] text-neutral-500">Wins / Losses</p>
          <p className="font-mono text-sm">
            <span className="text-green-400">{perf.wins}</span>
            {" / "}
            <span className="text-red-400">{perf.losses}</span>
            {perf.breakeven > 0 && <span className="text-neutral-500"> ({perf.breakeven} BE)</span>}
          </p>
        </div>
        <div className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
          <p className="text-[10px] text-neutral-500">Avg Win / Avg Loss</p>
          <p className="font-mono text-sm">
            <span className="text-green-400">{usd(perf.avgWin)}</span>
            {" / "}
            <span className="text-red-400">{usd(perf.avgLoss)}</span>
          </p>
        </div>
        <div className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
          <p className="text-[10px] text-neutral-500">Largest Win / Loss</p>
          <p className="font-mono text-sm">
            <span className="text-green-400">{usd(perf.largestWin)}</span>
            {" / "}
            <span className="text-red-400">{usd(perf.largestLoss)}</span>
          </p>
        </div>
        <div className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
          <p className="text-[10px] text-neutral-500">Streaks</p>
          <p className="font-mono text-sm">
            <span className="text-green-400">{perf.maxConsecWins}W</span>
            {" / "}
            <span className="text-red-400">{perf.maxConsecLosses}L</span>
            {" · Now: "}
            <span className={perf.currentStreak >= 0 ? "text-green-400" : "text-red-400"}>
              {perf.currentStreak > 0 ? `${perf.currentStreak}W` : perf.currentStreak < 0 ? `${Math.abs(perf.currentStreak)}L` : "—"}
            </span>
          </p>
        </div>
      </div>

      {/* Equity curve */}
      {perf.equityCurve.length > 1 && (
        <div className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Equity Curve</p>
          <EquityCurve data={perf.equityCurve} />
        </div>
      )}

      {/* By hour + by day */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">P&L by Hour (ET)</p>
          <div className="grid grid-cols-6 gap-1 text-[9px]">
            {Array.from({ length: 24 }, (_, h) => {
              const data = perf.byHour[h];
              if (!data) return null;
              return (
                <div key={h} className="text-center">
                  <div className="text-neutral-500">{h}:00</div>
                  <div className={cn("font-mono", data.pnl >= 0 ? "text-green-400" : "text-red-400")}>
                    {data.pnl >= 0 ? "+" : ""}{data.pnl.toFixed(0)}
                  </div>
                  <div className="text-neutral-600">{data.trades}t</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">P&L by Day of Week</p>
          <div className="grid grid-cols-7 gap-1 text-[9px]">
            {DOW_NAMES.map((name, dow) => {
              const data = perf.byDayOfWeek[dow];
              return (
                <div key={dow} className="text-center">
                  <div className="text-neutral-500">{name}</div>
                  <div className={cn("font-mono", (data?.pnl ?? 0) >= 0 ? "text-green-400" : "text-red-400")}>
                    {data ? `${data.pnl >= 0 ? "+" : ""}${data.pnl.toFixed(0)}` : "—"}
                  </div>
                  <div className="text-neutral-600">{data?.trades ?? 0}t</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EquityCurve({ data }: { data: { time: number; balance: number }[] }) {
  const width = 700;
  const height = 120;
  const pad = 4;

  const balances = data.map((d) => d.balance);
  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);
  const range = maxBal - minBal || 1;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - ((d.balance - minBal) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const lastBal = data[data.length - 1]?.balance ?? 0;
  const firstBal = data[0]?.balance ?? 0;
  const color = lastBal >= firstBal ? "#4ade80" : "#f87171";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points.join(" ")} />
      {/* Baseline */}
      <line
        x1={pad}
        x2={width - pad}
        y1={height - pad - ((firstBal - minBal) / range) * (height - pad * 2)}
        y2={height - pad - ((firstBal - minBal) / range) * (height - pad * 2)}
        stroke="#555"
        strokeWidth="0.5"
        strokeDasharray="4 2"
      />
    </svg>
  );
}

function TradesTab({ trips }: { trips: SimRoundTrip[] }) {
  const sorted = [...trips].reverse(); // most recent first
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-[10px]">
        <thead className="sticky top-0 bg-[#131722]">
          <tr className="border-b border-[#2a2e39] text-left text-neutral-500">
            <th className="px-2 py-1">Symbol</th>
            <th className="px-2 py-1">Side</th>
            <th className="px-2 py-1">Qty</th>
            <th className="px-2 py-1">Entry</th>
            <th className="px-2 py-1">Exit</th>
            <th className="px-2 py-1">P&L</th>
            <th className="px-2 py-1">Duration</th>
            <th className="px-2 py-1">Time</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td colSpan={8} className="px-2 py-4 text-center text-neutral-600">No completed trades yet</td></tr>
          )}
          {sorted.map((t) => {
            const dur = t.exitTime - t.entryTime;
            const mins = Math.floor(dur / 60);
            const hrs = Math.floor(mins / 60);
            const durStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
            const entryDate = new Date(t.entryTime * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return (
              <tr key={t.id} className="border-b border-[#1a1e29] hover:bg-[#1a1e29]">
                <td className="px-2 py-1 font-mono text-neutral-200">{t.symbol}</td>
                <td className={cn("px-2 py-1 font-semibold", t.side === "long" ? "text-green-400" : "text-red-400")}>
                  {t.side.toUpperCase()}
                </td>
                <td className="px-2 py-1 font-mono text-neutral-300">{t.qty}</td>
                <td className="px-2 py-1 font-mono text-neutral-300">{t.entryPrice.toFixed(2)}</td>
                <td className="px-2 py-1 font-mono text-neutral-300">{t.exitPrice.toFixed(2)}</td>
                <td className={cn("px-2 py-1 font-mono", t.realized >= 0 ? "text-green-400" : "text-red-400")}>
                  {t.realized >= 0 ? "+" : ""}{usd(t.realized)}
                </td>
                <td className="px-2 py-1 text-neutral-400">{durStr}</td>
                <td className="px-2 py-1 text-neutral-500">{entryDate}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JournalTab({ trips }: { trips: SimRoundTrip[] }) {
  const sorted = [...trips].reverse();
  const [editId, setEditId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");

  const startEdit = (t: SimRoundTrip) => {
    setEditId(t.id);
    const saved = loadJournalNote(t.id);
    setNote(saved?.note ?? t.note ?? "");
    setTags(saved?.tags ?? t.tags ?? "");
  };

  const saveEntry = () => {
    if (!editId) return;
    saveJournalNote(editId, note, tags);
    setEditId(null);
  };

  return (
    <div className="max-h-[60vh] space-y-2 overflow-y-auto">
      {sorted.length === 0 && (
        <p className="py-4 text-center text-xs text-neutral-600">No completed trades to journal yet</p>
      )}
      {sorted.map((t) => {
        const isEditing = editId === t.id;
        const saved = loadJournalNote(t.id);
        const hasNote = saved?.note || t.note;
        return (
          <div key={t.id} className="rounded border border-[#2a2e39] bg-[#0d1117] p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px]">
                <span className={cn("font-bold", t.side === "long" ? "text-green-400" : "text-red-400")}>
                  {t.side.toUpperCase()} {t.qty}
                </span>
                <span className="text-neutral-400">{t.symbol}</span>
                <span className="font-mono text-neutral-500">
                  {t.entryPrice.toFixed(2)} → {t.exitPrice.toFixed(2)}
                </span>
                <span className={cn("font-mono font-semibold", t.realized >= 0 ? "text-green-400" : "text-red-400")}>
                  {t.realized >= 0 ? "+" : ""}{usd(t.realized)}
                </span>
              </div>
              <button
                onClick={() => isEditing ? saveEntry() : startEdit(t)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px]",
                  isEditing ? "bg-green-800 text-green-200" : "bg-neutral-800 text-neutral-400 hover:text-white",
                )}
              >
                {isEditing ? "Save" : hasNote ? "Edit" : "Add Note"}
              </button>
            </div>

            {isEditing ? (
              <div className="mt-2 space-y-1.5">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What was your setup? Why did you enter? What did you learn?"
                  rows={3}
                  className="w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-blue-600"
                />
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Tags (comma-separated): breakout, trend, reversal..."
                  className="w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-2 py-1 text-xs text-neutral-200 outline-none focus:border-blue-600"
                />
              </div>
            ) : (
              hasNote && (
                <div className="mt-1">
                  <p className="text-[10px] text-neutral-300">{saved?.note ?? t.note}</p>
                  {(saved?.tags || t.tags) && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {(saved?.tags ?? t.tags ?? "").split(",").filter(Boolean).map((tag) => (
                        <span key={tag.trim()} className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[9px] text-blue-300">
                          {tag.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
