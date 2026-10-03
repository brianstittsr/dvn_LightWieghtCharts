"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { JevBlockEvent, JevRun } from "@/lib/jev/engine";
import { cn } from "@/lib/utils";

/** Replay speeds in events per second (1× ≈ the real ~300ms block cadence ×10). */
const SPEEDS = [30, 150, 600] as const;
const SPEED_LABELS = ["1×", "5×", "20×"] as const;

const money = (v: number, dp = 2): string =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(dp)}`;
const num = (v: number, dp = 4): string => v.toFixed(dp);

/** Jev-style replay dashboard — the result view for an HFT backtest run. */
export function JevDashboard({
  run,
  onClose,
}: {
  run: JevRun;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [window_, setWindow] = useState<number>(300);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = run.events.length;
  const done = idx >= total - 1;

  useEffect(() => {
    if (!playing || done) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    const perSec = SPEEDS[speed];
    // Cap steps so the interval stays a reasonable cadence.
    const tickMs = Math.max(16, 1000 / Math.min(perSec, 60));
    const step = Math.max(1, Math.round(perSec * (tickMs / 1000)));
    timerRef.current = setInterval(
      () => setIdx((i) => Math.min(i + step, total - 1)),
      tickMs,
    );
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, done, total]);

  const ev: JevBlockEvent = run.events[Math.min(idx, total - 1)];
  const strip = useMemo(
    () => run.events.slice(Math.max(0, idx - 59), idx + 1),
    [run.events, idx],
  );
  const windowEvents = useMemo(
    () => run.events.slice(Math.max(0, idx + 1 - window_), idx + 1),
    [run.events, idx, window_],
  );

  // Tape only shows fills up to the replay cursor.
  const visibleTape = useMemo(
    () => run.fills.filter((f) => f.block <= ev.block).slice(-12).reverse(),
    [run.fills, ev.block],
  );

  const d = ev.decision;
  const pnlPositive = ev.totals.pnlUsd >= 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0e13] text-neutral-200">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <span className="text-sm font-bold">⚡ Jev HFT</span>
        <span
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-semibold",
            done ? "text-neutral-500" : "text-emerald-400",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              done ? "bg-neutral-600" : "animate-pulse bg-emerald-400",
            )}
          />
          {done ? "finished" : "replay"}
        </span>
        <span className="font-mono text-xs text-neutral-300 tabular-nums">
          block {ev.block.toLocaleString()}
        </span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-300">
          {run.symbol} · {run.timeframe}
        </span>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold",
            run.modelKind === "ai"
              ? "bg-purple-900/60 text-purple-200"
              : "bg-amber-900/50 text-amber-200",
          )}
        >
          {run.modelLabel}
          {run.modelKind === "stand-in" ? " · stand-in" : ""}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
        >
          ✕ Close
        </button>
      </div>

      {/* ── Hero: price chart + decision panel ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_320px]">
        <div className="flex min-h-[220px] flex-col rounded-lg border border-neutral-800 bg-[#10141c] p-3">
          <div className="mb-1 flex items-center gap-3">
            <div className="flex gap-1">
              {[300, 1000, total].map((w) => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold",
                    window_ === w
                      ? "bg-[#2962ff] text-white"
                      : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
                  )}
                >
                  {w === total ? "All" : `${w} blocks`}
                </button>
              ))}
            </div>
            <span className="ml-auto font-mono text-lg font-bold tabular-nums">
              {num(ev.mid)}
            </span>
            {ev.position.side !== "flat" && (
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-bold",
                  ev.position.side === "long"
                    ? "bg-emerald-900/60 text-emerald-300"
                    : "bg-red-900/60 text-red-300",
                )}
              >
                {ev.position.side} {ev.position.size} · {money(ev.position.unrealizedUsd)}
              </span>
            )}
          </div>
          <PriceChart events={windowEvents} />
        </div>

        {/* ── Decision panel ── */}
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-[#10141c] p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">
            Decision — block {ev.block.toLocaleString()}
          </div>
          <div className="flex h-8 overflow-hidden rounded">
            <div
              className="flex items-center justify-center bg-emerald-600 text-[11px] font-bold text-white transition-all duration-150"
              style={{ width: `${d.probabilities.buy * 100}%` }}
            >
              {d.probabilities.buy >= 0.15 && `${Math.round(d.probabilities.buy * 100)}% BUY`}
            </div>
            <div
              className="flex items-center justify-center bg-red-600 text-[11px] font-bold text-white transition-all duration-150"
              style={{ width: `${d.probabilities.sell * 100}%` }}
            >
              {d.probabilities.sell >= 0.15 && `${Math.round(d.probabilities.sell * 100)}% SELL`}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span
              className={cn(
                "font-bold uppercase",
                d.late
                  ? "text-amber-400"
                  : d.action === "buy"
                    ? "text-emerald-400"
                    : d.action === "sell"
                      ? "text-red-400"
                      : "text-neutral-400",
              )}
            >
              {d.late ? "late — held" : d.action}
            </span>
            <span className="font-mono text-neutral-400 tabular-nums">
              {Math.round(d.latencyMs)} ms
            </span>
          </div>
          {/* 60-block tick strip */}
          <div className="mt-auto">
            <div className="mb-1 text-[10px] text-neutral-500">last 60 blocks</div>
            <div className="flex flex-wrap gap-[2px]">
              {strip.map((e) => (
                <div
                  key={e.block}
                  title={`block ${e.block}: ${e.decision.late ? "late" : e.decision.action}`}
                  className={cn(
                    "h-2.5 w-2.5 rounded-[2px]",
                    e.decision.late
                      ? "bg-amber-500"
                      : e.decision.action === "buy"
                        ? "bg-emerald-500"
                        : e.decision.action === "sell"
                          ? "bg-red-500"
                          : "bg-neutral-600",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Counters ── */}
      <div className="grid grid-cols-3 gap-2 px-3 sm:grid-cols-7">
        <Tile label="Blocks" value={ev.totals.blocks.toLocaleString()} />
        <Tile label="Decisions" value={ev.totals.decisions.toLocaleString()} />
        <Tile label="Quotes" value={ev.totals.quotes.toLocaleString()} />
        <Tile label="Fills" value={ev.totals.fills.toLocaleString()} />
        <Tile label="AI spend" value={money(ev.totals.aiUsd, 4)} />
        <Tile label="Fees" value={money(ev.totals.feeUsd, 4)} />
        <Tile
          label="P&L"
          value={`${money(ev.totals.pnlUsd)} ${ev.totals.pnlPct.toFixed(2)}%`}
          className={pnlPositive ? "text-emerald-400" : "text-red-400"}
        />
      </div>

      {/* ── Trade tape ── */}
      <div className="mx-3 mt-2 rounded-lg border border-neutral-800 bg-[#10141c]">
        <div className="border-b border-neutral-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
          Trade tape — last {visibleTape.length} fills
        </div>
        <div className="max-h-28 overflow-hidden">
          {visibleTape.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-neutral-500">No fills yet — quotes resting…</p>
          ) : (
            <table className="w-full text-[11px]">
              <tbody>
                {visibleTape.map((f, i) => (
                  <tr key={`${f.block}-${i}`} className="border-t border-neutral-800/60">
                    <td className="px-3 py-1 font-mono text-neutral-500 tabular-nums">
                      #{f.block.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1 font-bold uppercase",
                        f.side === "buy" ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {f.side}
                    </td>
                    <td className="px-2 py-1 tabular-nums">{f.size}</td>
                    <td className="px-2 py-1 font-mono tabular-nums">{num(f.price)}</td>
                    <td className="px-2 py-1 font-mono text-neutral-500 tabular-nums">
                      {Math.round(f.latencyMs)} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setPlaying(!playing)}
          className="rounded bg-[#2962ff] px-3 py-1 text-xs font-bold text-white hover:bg-[#1e53e5]"
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        {SPEED_LABELS.map((l, i) => (
          <button
            key={l}
            onClick={() => {
              setSpeed(i);
              setPlaying(true);
            }}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-semibold",
              speed === i && playing
                ? "bg-neutral-200 text-neutral-900"
                : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
            )}
          >
            {l}
          </button>
        ))}
        <button
          onClick={() => {
            setIdx(total - 1);
            setPlaying(false);
          }}
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
        >
          ⏭ End
        </button>
        <div className="ml-3 h-1.5 flex-1 overflow-hidden rounded bg-neutral-800">
          <div
            className="h-full bg-[#2962ff] transition-[width] duration-150"
            style={{ width: `${((idx + 1) / total) * 100}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-neutral-500 tabular-nums">
          {idx + 1}/{total}
        </span>
      </div>

      <div className="border-t border-neutral-800 px-4 py-1.5 text-[10px] text-neutral-600">
        Synthetic ticks decomposed from {run.timeframe} candles · simulated fills ·
        {run.modelKind === "stand-in" ? " stand-in momentum model (not real Jev)" : " AI-generated strategy model"}
        {" "}· not financial advice
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-[#10141c] px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={cn("font-mono text-sm font-bold tabular-nums", className)}>
        {value}
      </div>
    </div>
  );
}

/** SVG mid-price line with ▲/▼ fill markers. */
function PriceChart({ events }: { events: JevBlockEvent[] }) {
  const W = 800;
  const H = 180;
  if (events.length < 2) {
    return <div className="flex-1 rounded bg-neutral-900/50" />;
  }
  const prices = events.map((e) => e.mid);
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const x = (i: number) => (i / (events.length - 1)) * W;
  const y = (p: number) => H - ((p - min) / (max - min)) * H;
  const pts = events.map((e, i) => `${x(i).toFixed(1)},${y(e.mid).toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="min-h-0 w-full flex-1 rounded bg-neutral-900/50"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="#2962ff"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      {events.map((e, i) =>
        e.fill ? (
          <polygon
            key={e.block}
            points={
              e.fill.side === "buy"
                ? `${x(i)},${y(e.fill.price) + 8} ${x(i) - 4},${y(e.fill.price) + 14} ${x(i) + 4},${y(e.fill.price) + 14}`
                : `${x(i)},${y(e.fill.price) - 8} ${x(i) - 4},${y(e.fill.price) - 14} ${x(i) + 4},${y(e.fill.price) - 14}`
            }
            fill={e.fill.side === "buy" ? "#34d399" : "#f87171"}
            opacity="0.9"
          />
        ) : null,
      )}
    </svg>
  );
}
