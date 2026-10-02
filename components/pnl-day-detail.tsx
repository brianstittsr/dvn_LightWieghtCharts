"use client";

import { useState } from "react";
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

  const [y, m, d] = day.date.split("-").map(Number);
  const title = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-700 bg-[#0d0f13] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-neutral-100">{title}</h3>
            <span
              className={cn(
                "font-mono text-sm font-semibold",
                day.pnl > 0 ? "text-green-400" : day.pnl < 0 ? "text-red-400" : "text-neutral-400",
              )}
            >
              {fmtSigned(day.pnl)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-xl text-neutral-500 hover:text-neutral-200"
            aria-label="Close day detail"
          >
            ×
          </button>
        </div>

        {/* Fills */}
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            Trades ({day.details.length})
          </div>
          {day.details.length === 0 ? (
            <div className="rounded bg-neutral-900/60 px-3 py-2 text-xs text-neutral-500">
              No fills recorded for this day.
            </div>
          ) : (
            <div className="divide-y divide-neutral-800/60 rounded border border-neutral-800">
              {day.details.map((t, i) => (
                <div key={`${t.time}-${t.symbol}-${i}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <span className="w-11 shrink-0 font-mono text-neutral-500">
                    {etTime.format(new Date(t.time))}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono font-semibold text-neutral-200" title={t.symbol}>
                    {t.symbol}
                    {t.assetClass === "option" && (
                      <span className="ml-1 rounded bg-blue-900/50 px-1 text-[9px] font-normal text-blue-300">
                        OPT
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "w-8 shrink-0 text-[10px] font-bold uppercase",
                      t.side === "buy" ? "text-green-400" : "text-red-400",
                    )}
                  >
                    {t.side}
                  </span>
                  <span className="shrink-0 font-mono text-neutral-300">
                    {t.qty} @ {fmt(t.price)}
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono">
                    {t.closedQty === 0 ? (
                      <span className="rounded bg-neutral-800 px-1 text-[9px] font-semibold text-neutral-400">
                        OPEN
                      </span>
                    ) : (
                      <span className={t.realized > 0 ? "text-green-400" : t.realized < 0 ? "text-red-400" : "text-neutral-400"}>
                        {fmtSigned(t.realized)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

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
