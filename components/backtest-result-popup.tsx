"use client";

import type { BacktestResult } from "@/lib/backtest";
import { nyDateTime } from "@/lib/time-format";

const usd = (v: number): string =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signedUsd = (v: number): string => `${v >= 0 ? "+" : ""}${usd(v)}`;

function Metric({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "neu" }) {
  const color =
    tone === "pos" ? "text-green-400" : tone === "neg" ? "text-red-400" : "text-neutral-100";
  return (
    <div className="flex flex-col rounded bg-neutral-800/60 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={`font-mono text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

/** Simple inline-SVG equity curve. */
function EquityCurve({ points }: { points: { time: number; equity: number }[] }) {
  if (points.length < 2) return null;
  const w = 100;
  const h = 30;
  const min = Math.min(...points.map((p) => p.equity));
  const max = Math.max(...points.map((p) => p.equity));
  const span = max - min || 1;
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(2)},${(
          h - ((p.equity - min) / span) * (h - 2) - 1
        ).toFixed(2)}`,
    )
    .join(" ");
  const up = points[points.length - 1].equity >= points[0].equity;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full">
      <path d={path} fill="none" strokeWidth={1.2} stroke={up ? "#34d399" : "#f87171"} />
    </svg>
  );
}

/** Ported from TopStepTradingSystem BacktestResultPopup — Tailwind version. */
export function BacktestResultPopup({
  result,
  onClose,
}: {
  result: BacktestResult | null;
  onClose: () => void;
}) {
  if (!result) return null;
  const s = result.summary;
  const isProfit = s.totalProfit >= 0;
  const isProfitable = s.winRate >= 50;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border-2 bg-[#16181d] shadow-2xl ${
          isProfitable ? "border-green-600/60" : "border-red-600/60"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative px-5 pt-5">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 text-xl text-neutral-500 hover:text-neutral-200"
            aria-label="Close"
          >
            ×
          </button>
          <div className="text-center">
            <div className="text-3xl">{isProfitable ? "📊" : "📉"}</div>
            <h2 className="mt-1 text-lg font-bold text-neutral-100">Backtest Complete</h2>
            <div className="text-[10px] text-neutral-500">
              {result.id} · {result.symbol} · {result.timeframe} · {result.bars} bars
            </div>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              {isProfit ? "Total Profit" : "Total Loss"}
            </div>
            <div className={`font-mono text-3xl font-bold ${isProfit ? "text-green-400" : "text-red-400"}`}>
              {signedUsd(s.totalProfit)}
            </div>
            <div className={`font-mono text-xs ${isProfit ? "text-green-500" : "text-red-500"}`}>
              {s.returnPercent >= 0 ? "+" : ""}
              {s.returnPercent.toFixed(2)}% return
            </div>
          </div>

          <EquityCurve points={result.equityCurve} />

          <div className="grid grid-cols-3 gap-2">
            <Metric label="Trades" value={s.totalTrades.toLocaleString()} />
            <Metric label="Win rate" value={`${s.winRate.toFixed(1)}%`} tone={s.winRate >= 50 ? "pos" : "neg"} />
            <Metric
              label="Profit factor"
              value={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}
              tone={s.profitFactor >= 1.5 ? "pos" : "neu"}
            />
            <Metric label="Wins" value={s.winningTrades.toLocaleString()} tone="pos" />
            <Metric label="Losses" value={s.losingTrades.toLocaleString()} tone="neg" />
            <Metric
              label="Max drawdown"
              value={`${usd(s.maxDrawdown)} (${s.maxDrawdownPercent.toFixed(1)}%)`}
              tone="neg"
            />
          </div>

          <div className="space-y-1 rounded bg-neutral-800/40 p-3 text-[11px]">
            <div className="flex justify-between">
              <span className="text-neutral-500">Initial → Final</span>
              <span className="font-mono text-neutral-200">
                {usd(s.initialCapital)} → {usd(s.finalCapital)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Avg win / avg loss</span>
              <span className="font-mono text-neutral-200">
                {usd(s.avgWin)} / {usd(s.avgLoss)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Best / worst trade</span>
              <span className="font-mono text-neutral-200">
                {signedUsd(s.bestTrade)} / {signedUsd(s.worstTrade)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Range (ET)</span>
              <span className="font-mono text-neutral-200">
                {nyDateTime(result.startTime)} → {nyDateTime(result.endTime)}
              </span>
            </div>
          </div>

          {result.trades.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded border border-neutral-800">
              <table className="w-full text-left font-mono text-[10px]">
                <thead className="sticky top-0 bg-neutral-800 text-neutral-400">
                  <tr>
                    <th className="px-2 py-1">Exit (ET)</th>
                    <th className="px-2 py-1">Side</th>
                    <th className="px-2 py-1 text-right">Entry</th>
                    <th className="px-2 py-1 text-right">Exit</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1">Via</th>
                    <th className="px-2 py-1 text-right">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice(-200).map((t, i) => (
                    <tr key={i} className="border-t border-neutral-800/60">
                      <td className="px-2 py-1 text-neutral-400">{nyDateTime(t.exitTime)}</td>
                      <td className={`px-2 py-1 ${t.side === "long" ? "text-green-400" : "text-red-400"}`}>
                        {t.side.toUpperCase()}
                      </td>
                      <td className="px-2 py-1 text-right">{t.entry.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{t.exit.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{t.qty.toFixed(4)}</td>
                      <td className="px-2 py-1 text-neutral-500">{t.exitReason}</td>
                      <td className={`px-2 py-1 text-right ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {signedUsd(t.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div
            className={`rounded p-3 text-[11px] ${
              isProfitable ? "bg-green-900/20 text-green-300" : "bg-amber-900/20 text-amber-300"
            }`}
          >
            {isProfitable ? (
              <>This strategy shows a positive edge on the loaded data — win rate {s.winRate.toFixed(1)}%, profit factor {Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}.</>
            ) : (
              <>Strategy underperformed on this data — consider different parameters or a different symbol/timeframe.</>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded bg-neutral-700 px-4 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
