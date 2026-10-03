"use client";

import { useMemo, useState } from "react";
import type { DayPnl } from "@/app/api/alpaca/pnl/route";
import { cn, signed, usd } from "@/lib/utils";

const JOURNAL_PREFIX = "pnl-journal:";

export interface DayJournal {
  mood: "good" | "neutral" | "bad" | null;
  followedPlan: boolean;
  notes: string;
}

const EMPTY_JOURNAL: DayJournal = { mood: null, followedPlan: false, notes: "" };

/** Fill time in New York (HH:MM, 24h). */
const etTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

/** Fill time in New York (h:mm AM/PM) — matches the trade-list style. */
const etTimeAmPm = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: true,
  hour: "numeric",
  minute: "2-digit",
});

function readJournal(date: string): DayJournal {
  try {
    const raw = window.localStorage.getItem(JOURNAL_PREFIX + date);
    if (!raw) return EMPTY_JOURNAL;
    const j = JSON.parse(raw) as Partial<DayJournal>;
    return {
      mood: j.mood === "good" || j.mood === "neutral" || j.mood === "bad" ? j.mood : null,
      followedPlan: j.followedPlan === true,
      notes: typeof j.notes === "string" ? j.notes : "",
    };
  } catch {
    return EMPTY_JOURNAL;
  }
}

interface PnlDayDetailProps {
  /** Filtered day view (details already limited to the active asset filter). */
  day: DayPnl;
  hideAmounts: boolean;
  onClose: () => void;
  /** Called after a journal entry is saved so the calendar can show 📝. */
  onJournalSaved: (date: string) => void;
}

/**
 * Day drill-down overlay nested inside the P&L calendar modal: per-fill trade
 * list, a compact quick-order ticket, and a localStorage-backed day journal.
 */
export function PnlDayDetail({ day, hideAmounts, onClose, onJournalSaved }: PnlDayDetailProps) {
  const fmt = (v: number): string => (hideAmounts ? "•••" : usd(v));
  const fmtSigned = (v: number): string => (hideAmounts ? "•••" : signed(v));

  const [orderSymbol, setOrderSymbol] = useState("");
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderQty, setOrderQty] = useState("1");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderStatus, setOrderStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // The parent remounts this component via key={day.date}, so lazy
  // initializers always load the journal for the selected day.
  const [journal, setJournal] = useState<DayJournal>(() => readJournal(day.date));
  const [journalMsg, setJournalMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"charts" | "list">("charts");

  const [y, m, d] = day.date.split("-").map(Number);
  const title = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  /**
   * Round-trip series: one entry per fill that closed qty — drives the
   * cumulative P/L curve, the per-trade bar chart, and the W/L/BE badges.
   */
  const stats = useMemo(() => {
    const closers = [...day.details]
      .filter((t) => t.closedQty > 0)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const points = closers.reduce<{ time: string; value: number; tradePnl: number }[]>(
      (acc, t, i) => [
        ...acc,
        { time: t.time, value: (acc[i - 1]?.value ?? 0) + t.realized, tradePnl: t.realized },
      ],
      [],
    );
    const be = closers.filter((t) => t.realized === 0).length;
    return { points, trades: closers.length, breakeven: be };
  }, [day.details]);

  async function submitOrder(): Promise<void> {
    const qty = Number(orderQty);
    const symbol = orderSymbol.trim().toUpperCase();
    if (!symbol || !(qty > 0)) {
      setOrderStatus({ kind: "err", text: "Enter a symbol and qty > 0" });
      return;
    }
    setOrderBusy(true);
    setOrderStatus(null);
    try {
      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, qty, side: orderSide, type: "market" }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Order failed (${res.status})`);
      window.dispatchEvent(new Event("alpaca-orders-changed"));
      setOrderStatus({ kind: "ok", text: `${orderSide.toUpperCase()} ${qty} ${symbol} submitted` });
    } catch (err) {
      setOrderStatus({ kind: "err", text: err instanceof Error ? err.message : "Order failed" });
    } finally {
      setOrderBusy(false);
    }
  }

  function saveJournal(): void {
    try {
      window.localStorage.setItem(JOURNAL_PREFIX + day.date, JSON.stringify(journal));
      onJournalSaved(day.date);
      setJournalMsg("Saved");
    } catch {
      setJournalMsg("Could not save (storage unavailable)");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        // Don't let the click bubble to the calendar backdrop (would close it).
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-neutral-700 bg-[#0d0f13] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-neutral-100">
              <span className={day.pnl >= 0 ? "text-green-400" : "text-red-400"}>
                {day.pnl >= 0 ? "↗" : "↘"}
              </span>
              Trade Details - {title}
            </h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  day.pnl >= 0 ? "bg-green-900/60 text-green-300" : "bg-red-900/60 text-red-300",
                )}
              >
                Daily P/L: {fmtSigned(day.pnl)}
              </span>
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                {day.trades} Total Trades
              </span>
              <span className="rounded bg-green-900/60 px-1.5 py-0.5 text-green-300">
                {day.wins} Wins
              </span>
              {day.losses > 0 && (
                <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-red-300">
                  {day.losses} Losses
                </span>
              )}
              {stats.breakeven > 0 && (
                <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-green-200">
                  {stats.breakeven} B/E
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xl text-neutral-500 hover:text-neutral-200"
            aria-label="Close day detail"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-3 grid grid-cols-2 overflow-hidden rounded border border-neutral-700">
          {(["charts", "list"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "py-1.5 text-xs font-semibold",
                tab === t
                  ? "bg-neutral-700 text-white"
                  : "bg-neutral-900/60 text-neutral-400 hover:text-neutral-200",
              )}
            >
              {t === "charts" ? "Charts" : "Trade List"}
            </button>
          ))}
        </div>

        {tab === "charts" ? (
          <div className="mb-3">
            {stats.points.length === 0 ? (
              <div className="rounded bg-neutral-900/60 px-3 py-6 text-center text-xs text-neutral-500">
                No closed trades to chart for this day.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChartCard title="Cumulative P/L">
                  <CumulativeChart points={stats.points} />
                </ChartCard>
                <ChartCard title="P/L by Trade">
                  <TradeBars points={stats.points} />
                </ChartCard>
              </div>
            )}
          </div>
        ) : (
          /* Trade list */
          <div className="mb-3">
            {day.details.length === 0 ? (
              <div className="rounded bg-neutral-900/60 px-3 py-2 text-xs text-neutral-500">
                No fills recorded for this day.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left text-[10px] uppercase tracking-wide text-neutral-500">
                    <th className="py-1.5 pr-3">Time</th>
                    <th className="pr-3">Symbol</th>
                    <th className="pr-3">Side</th>
                    <th className="pr-3 text-right">Qty</th>
                    <th className="pr-3 text-right">Price</th>
                    <th className="text-right">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {day.details.map((t, i) => (
                    <tr key={`${t.time}-${t.symbol}-${i}`} className="border-b border-neutral-800/60 last:border-0">
                      <td className="py-2 pr-3 font-mono text-neutral-400">
                        {etTimeAmPm.format(new Date(t.time))}
                      </td>
                      <td className="pr-3 font-mono font-semibold text-neutral-200">
                        {t.symbol}
                        {t.assetClass === "option" && (
                          <span className="ml-1 rounded bg-blue-900/50 px-1 text-[9px] font-normal text-blue-300">
                            OPT
                          </span>
                        )}
                      </td>
                      <td className="pr-3">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                            t.side === "buy"
                              ? "bg-blue-900/60 text-blue-300"
                              : "bg-orange-900/60 text-orange-300",
                          )}
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="pr-3 text-right font-mono text-neutral-300">{t.qty}</td>
                      <td className="pr-3 text-right font-mono text-neutral-300">{fmt(t.price)}</td>
                      <td className="text-right font-mono">
                        {t.closedQty === 0 ? (
                          <span className="rounded bg-neutral-800 px-1 text-[9px] font-semibold text-neutral-400">
                            OPEN
                          </span>
                        ) : (
                          <span className={t.realized > 0 ? "text-green-400" : t.realized < 0 ? "text-red-400" : "text-neutral-400"}>
                            {fmtSigned(t.realized)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Quick order */}
        <div className="mb-3 rounded border border-neutral-800 p-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            New trade
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={orderSymbol}
              onChange={(e) => setOrderSymbol(e.target.value)}
              placeholder="Symbol"
              className="w-20 rounded bg-neutral-800 px-1.5 py-1 font-mono text-xs uppercase text-neutral-200 outline-none"
              aria-label="Order symbol"
            />
            <div className="flex overflow-hidden rounded border border-neutral-700">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setOrderSide(s)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-semibold uppercase",
                    orderSide === s
                      ? s === "buy"
                        ? "bg-green-700 text-white"
                        : "bg-red-700 text-white"
                      : "bg-neutral-800 text-neutral-400",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              value={orderQty}
              onChange={(e) => setOrderQty(e.target.value)}
              type="number"
              min="0"
              step="any"
              className="w-16 rounded bg-neutral-800 px-1.5 py-1 font-mono text-xs text-neutral-200 outline-none"
              aria-label="Quantity"
            />
            <button
              onClick={submitOrder}
              disabled={orderBusy}
              className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              {orderBusy ? "…" : "Submit"}
            </button>
            {orderStatus && (
              <span className={cn("text-[10px]", orderStatus.kind === "ok" ? "text-green-400" : "text-red-400")}>
                {orderStatus.text}
              </span>
            )}
          </div>
        </div>

        {/* Day journal */}
        <div className="rounded border border-neutral-800 p-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            Day journal
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {(["good", "neutral", "bad"] as const).map((mo) => (
              <button
                key={mo}
                onClick={() => setJournal((j) => ({ ...j, mood: j.mood === mo ? null : mo }))}
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-semibold capitalize",
                  journal.mood === mo
                    ? mo === "good"
                      ? "bg-green-700 text-white"
                      : mo === "bad"
                        ? "bg-red-700 text-white"
                        : "bg-neutral-600 text-white"
                    : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
                )}
              >
                {mo}
              </button>
            ))}
            <label className="ml-1 flex items-center gap-1.5 text-[11px] text-neutral-300">
              <input
                type="checkbox"
                checked={journal.followedPlan}
                onChange={(e) => setJournal((j) => ({ ...j, followedPlan: e.target.checked }))}
                className="accent-green-600"
              />
              Followed plan
            </label>
          </div>
          <textarea
            value={journal.notes}
            onChange={(e) => setJournal((j) => ({ ...j, notes: e.target.value }))}
            placeholder="Notes on this day…"
            rows={3}
            className="w-full resize-y rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={saveJournal}
              className="rounded bg-neutral-700 px-2 py-1 text-[11px] font-medium text-neutral-200 hover:bg-neutral-600"
            >
              Save journal
            </button>
            {journalMsg && <span className="text-[10px] text-neutral-400">{journalMsg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Charts ─────────────────────────────────────────────── */

const CW = 320;
const CH = 150;
const PAD = { l: 46, r: 8, t: 10, b: 18 };

interface CumPoint {
  time: string;
  value: number;
  tradePnl: number;
}

function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Shared y-scale helper: returns y pixel for a value within the chart box. */
function yScale(min: number, max: number): (v: number) => number {
  const ih = CH - PAD.t - PAD.b;
  const span = max - min || 1;
  return (v) => PAD.t + ih * (1 - (v - min) / span);
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-neutral-800 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
        {title}
      </div>
      {children}
    </div>
  );
}

/** Cumulative P/L area chart across the day's closed trades. */
function CumulativeChart({ points }: { points: CumPoint[] }) {
  const iw = CW - PAD.l - PAD.r;
  const values = [0, ...points.map((p) => p.value)];
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const max = rawMax > 0 ? niceCeil(rawMax) : 0;
  const min = rawMin < 0 ? -niceCeil(-rawMin) : 0;
  const y = yScale(min, max || 1);
  const x = (i: number) => PAD.l + (i / Math.max(1, points.length)) * iw;
  const linePts = points.map((p, i) => `${x(i + 1)},${y(p.value)}`).join(" ");
  const base = y(Math.max(0, min));
  const ticks = [min, min / 2 || 0, 0, max / 2, max].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full">
      <defs>
        <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={CW - PAD.r} y1={y(v)} y2={y(v)} stroke="#262a33" strokeDasharray={v === 0 ? "" : "3 3"} />
          <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#6b7280">
            {v === 0 ? "$0" : `$${Math.round(v)}`}
          </text>
        </g>
      ))}
      <polygon points={`${x(0)},${base} ${linePts} ${x(points.length)},${base}`} fill="url(#cumFill)" />
      <polyline points={`${x(0)},${y(0)} ${linePts}`} fill="none" stroke="#22c55e" strokeWidth="1.5" />
      <text x={x(0) + 2} y={CH - 4} fontSize="8" fill="#6b7280">
        {etTime.format(new Date(points[0].time))}
      </text>
      <text x={CW - PAD.r} y={CH - 4} textAnchor="end" fontSize="8" fill="#6b7280">
        {etTime.format(new Date(points[points.length - 1].time))}
      </text>
    </svg>
  );
}

/** Per-trade P/L bar chart (#1, #2, … across the x axis). */
function TradeBars({ points }: { points: CumPoint[] }) {
  const iw = CW - PAD.l - PAD.r;
  const rawMax = Math.max(0, ...points.map((p) => p.tradePnl));
  const rawMin = Math.min(0, ...points.map((p) => p.tradePnl));
  const max = rawMax > 0 ? niceCeil(rawMax) : 0;
  const min = rawMin < 0 ? -niceCeil(-rawMin) : 0;
  const y = yScale(min, max || 1);
  const slot = iw / points.length;
  const bw = Math.min(28, slot * 0.6);
  const ticks = [min, min / 2 || 0, 0, max / 2, max].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={CW - PAD.r} y1={y(v)} y2={y(v)} stroke="#262a33" strokeDasharray={v === 0 ? "" : "3 3"} />
          <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#6b7280">
            {v === 0 ? "$0" : `$${Math.round(v)}`}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const h = Math.abs(y(p.tradePnl) - y(0));
        return (
          <g key={i}>
            <rect
              x={PAD.l + i * slot + (slot - bw) / 2}
              y={p.tradePnl >= 0 ? y(p.tradePnl) : y(0)}
              width={bw}
              height={Math.max(1, h)}
              rx="1"
              fill={p.tradePnl > 0 ? "#22c55e" : p.tradePnl < 0 ? "#ef4444" : "#6b7280"}
            />
            {points.length <= 16 && (
              <text
                x={PAD.l + i * slot + slot / 2}
                y={CH - 4}
                textAnchor="middle"
                fontSize="8"
                fill="#6b7280"
              >
                #{i + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
