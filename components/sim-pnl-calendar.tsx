"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SimAccountState, SimDayPnl } from "@/lib/sim-account";
import { simDailyPnl, simChallengeMetrics } from "@/lib/sim-account";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border-l-2 border-neutral-700 pl-3">
      <span className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</span>
      <span className="mt-0.5 font-mono text-[11px] text-neutral-200">{children}</span>
    </div>
  );
}

interface SimPnlCalendarProps {
  open: boolean;
  onClose: () => void;
  simAccount: SimAccountState;
  onReset: () => void;
}

export function SimPnlCalendar({ open, onClose, simAccount, onReset }: SimPnlCalendarProps) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return now.getFullYear() * 12 + now.getMonth();
  });

  const year = Math.floor(month / 12);
  const mo = month % 12;

  const days = useMemo(() => simDailyPnl(simAccount), [simAccount]);
  const metrics = useMemo(() => simChallengeMetrics(simAccount), [simAccount]);

  const byDate = useMemo(() => {
    const map = new Map<string, SimDayPnl>();
    for (const d of days) map.set(d.date, d);
    return map;
  }, [days]);

  // Calendar grid
  const firstDay = new Date(year, mo, 1);
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0

  const cells: (SimDayPnl | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push(byDate.get(dateStr) ?? null);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  // Monthly aggregates
  const monthDays = days.filter((d) => d.date.startsWith(`${year}-${String(mo + 1).padStart(2, "0")}`));
  const monthPnl = monthDays.reduce((s, d) => s + d.pnl, 0);
  const monthTrades = monthDays.reduce((s, d) => s + d.trades, 0);
  const monthWins = monthDays.reduce((s, d) => s + d.wins, 0);
  const monthLosses = monthDays.reduce((s, d) => s + d.losses, 0);
  const greenDays = monthDays.filter((d) => d.pnl > 0).length;
  const redDays = monthDays.filter((d) => d.pnl < 0).length;
  const winRate = monthWins + monthLosses > 0 ? (monthWins / (monthWins + monthLosses)) * 100 : 0;

  // Overall aggregates
  const totalPnl = simAccount.balance - simAccount.startBalance;
  const totalTrades = days.reduce((s, d) => s + d.trades, 0);

  // Max cell pnl for heatmap scaling
  const maxAbsPnl = Math.max(...days.map((d) => Math.abs(d.pnl)), 1);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#2a2e39] bg-[#131722] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">
            Sim P&L Calendar
            {simAccount.challenge && (
              <span className="ml-2 rounded bg-blue-900/50 px-2 py-0.5 text-[10px] text-blue-300">
                {simAccount.challenge.name}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onReset}
              className="rounded bg-red-900/60 px-2 py-0.5 text-[10px] font-semibold text-red-300 hover:bg-red-800"
            >
              Reset Account
            </button>
            <button onClick={onClose} className="text-neutral-500 hover:text-white" aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Account summary */}
        <div className="mb-4 flex flex-wrap gap-4">
          <Stat label="Balance">{usd(simAccount.balance)}</Stat>
          <Stat label="Total P&L">
            <span className={totalPnl >= 0 ? "text-green-400" : "text-red-400"}>{usd(totalPnl)}</span>
          </Stat>
          <Stat label="Peak">{usd(simAccount.peakBalance)}</Stat>
          <Stat label="Drawdown">
            <span className="text-red-400">{usd(simAccount.peakBalance - simAccount.balance)}</span>
          </Stat>
          <Stat label="Trades">{totalTrades}</Stat>
          <Stat label="Trading Days">{days.length}</Stat>
        </div>

        {/* Challenge progress */}
        {metrics && (
          <div className="mb-4 rounded border border-[#2a2e39] bg-[#0d1117] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-400">Challenge Progress</span>
              {metrics.passed ? (
                <span className="rounded bg-green-800/50 px-2 py-0.5 text-[10px] font-bold text-green-300">PASSED</span>
              ) : (
                <span className="text-[10px] text-neutral-500">In Progress</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-[10px] sm:grid-cols-5">
              <RuleBar
                label="Profit"
                current={metrics.rules.profitTarget.current}
                target={metrics.rules.profitTarget.target}
                passed={metrics.rules.profitTarget.passed}
                positive
              />
              <RuleBar
                label="Max Loss"
                current={metrics.rules.maxLoss.current}
                target={metrics.rules.maxLoss.limit}
                passed={metrics.rules.maxLoss.passed}
              />
              <RuleBar
                label="Daily Loss"
                current={metrics.rules.maxDailyLoss.current}
                target={metrics.rules.maxDailyLoss.limit}
                passed={metrics.rules.maxDailyLoss.passed}
              />
              <RuleBar
                label="Days"
                current={metrics.rules.minDays.current}
                target={metrics.rules.minDays.required}
                passed={metrics.rules.minDays.passed}
                positive
                isCount
              />
              {metrics.rules.consistency && (
                <RuleBar
                  label="Consistency"
                  current={metrics.rules.consistency.current}
                  target={metrics.rules.consistency.limit}
                  passed={metrics.rules.consistency.passed}
                  isPct
                />
              )}
            </div>
          </div>
        )}

        {/* Month nav */}
        <div className="mb-3 flex items-center justify-center gap-3">
          <button
            onClick={() => setMonth((m) => m - 1)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            ◀
          </button>
          <span className="min-w-24 text-center text-xs font-semibold text-white">
            {MONTHS[mo]} {year}
          </span>
          <button
            onClick={() => setMonth((m) => m + 1)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            ▶
          </button>
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px text-center text-[9px] font-semibold text-neutral-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="pb-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px">
          {cells.map((cell, i) => {
            const dayNum = i - startDow + 1;
            const isValid = dayNum >= 1 && dayNum <= daysInMonth;
            if (!isValid) return <div key={i} className="h-14" />;

            const alpha = cell ? Math.min(1, Math.abs(cell.pnl) / maxAbsPnl) : 0;
            const bg = cell
              ? cell.pnl >= 0
                ? `rgba(34, 197, 94, ${0.1 + alpha * 0.5})`
                : `rgba(239, 68, 68, ${0.1 + alpha * 0.5})`
              : undefined;

            return (
              <div
                key={i}
                className="flex h-14 flex-col items-center justify-center rounded border border-[#1a1e29]"
                style={bg ? { backgroundColor: bg } : undefined}
              >
                <span className="text-[9px] text-neutral-500">{dayNum}</span>
                {cell && (
                  <>
                    <span
                      className={cn(
                        "font-mono text-[10px] font-semibold",
                        cell.pnl >= 0 ? "text-green-300" : "text-red-300",
                      )}
                    >
                      {cell.pnl >= 0 ? "+" : ""}${Math.abs(cell.pnl).toFixed(0)}
                    </span>
                    <span className="text-[8px] text-neutral-600">
                      {cell.wins}W {cell.losses}L
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Monthly stats */}
        <div className="mt-3 flex flex-wrap gap-4 border-t border-[#2a2e39] pt-3">
          <Stat label="Month P&L">
            <span className={monthPnl >= 0 ? "text-green-400" : "text-red-400"}>{usd(monthPnl)}</span>
          </Stat>
          <Stat label="Trades">{monthTrades}</Stat>
          <Stat label="Win Rate">{winRate.toFixed(1)}%</Stat>
          <Stat label="Green Days">{greenDays}</Stat>
          <Stat label="Red Days">{redDays}</Stat>
        </div>
      </div>
    </div>
  );
}

/** Small progress bar for challenge rules. */
function RuleBar({
  label,
  current,
  target,
  passed,
  positive,
  isCount,
  isPct,
}: {
  label: string;
  current: number;
  target: number;
  passed: boolean;
  positive?: boolean;
  isCount?: boolean;
  isPct?: boolean;
}) {
  const pct = target > 0 ? Math.min(1, Math.abs(current) / target) : 0;
  const color = passed
    ? positive
      ? "bg-green-500"
      : "bg-green-500"
    : positive
      ? "bg-blue-500"
      : "bg-red-500";

  const display = isCount
    ? `${current}/${target}`
    : isPct
      ? `${current}%/${target}%`
      : `$${Math.abs(current).toFixed(0)}/$${target.toFixed(0)}`;

  return (
    <div>
      <div className="mb-0.5 flex justify-between">
        <span className="text-neutral-500">{label}</span>
        {passed && <span className="text-green-400">✓</span>}
      </div>
      <div className="h-1.5 w-full rounded-full bg-neutral-800">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="font-mono text-[9px] text-neutral-400">{display}</span>
    </div>
  );
}
