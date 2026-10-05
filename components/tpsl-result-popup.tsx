"use client";

import { useEffect, useState } from "react";

export interface TpslResult {
  symbol: string;
  kind: "tp" | "sl";
  side: "long" | "short";
  qty: number;
  entry: number;
  exit: number;
  pnl: number;
}

/** Popup shown when a drawn TP/SL line triggers and the position is closed. */
export function TpslResultPopup({
  result,
  onClose,
}: {
  result: TpslResult | null;
  onClose: () => void;
}) {
  const [seconds, setSeconds] = useState(0);

  // Auto-dismiss after 12s — enough to register the outcome.
  useEffect(() => {
    if (!result) return;
    const started = Date.now();
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    const done = setTimeout(onClose, 12_000);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [result, onClose]);

  if (!result) return null;
  const won = result.pnl >= 0;
  const label = result.kind === "tp" ? "Take Profit" : "Stop Loss";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-xs rounded-lg border p-4 shadow-2xl ${
          won
            ? "border-green-700 bg-[#0f1a12]"
            : "border-red-700 bg-[#1a0f10]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <span
            className={`text-base font-bold ${won ? "text-green-300" : "text-red-300"}`}
          >
            {won ? "✓ WIN" : "✕ LOSS"} — {label} hit
          </span>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="mb-2 text-[11px] text-neutral-400">
          {result.symbol} · {result.side} position closed
        </div>

        <div className="space-y-1 rounded bg-black/30 p-2 font-mono text-[11px]">
          <div className="flex justify-between text-neutral-300">
            <span>Contracts closed</span>
            <span className="font-semibold text-neutral-100">{result.qty}</span>
          </div>
          <div className="flex justify-between text-neutral-300">
            <span>Entry</span>
            <span>${result.entry.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-neutral-300">
            <span>Exit ≈</span>
            <span>${result.exit.toFixed(2)}</span>
          </div>
          <div
            className={`flex justify-between border-t border-neutral-700 pt-1 text-sm font-bold ${
              won ? "text-green-400" : "text-red-400"
            }`}
          >
            <span>P&L</span>
            <span>
              {won ? "+" : ""}${result.pnl.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="mt-2 text-center text-[9px] text-neutral-600">
          auto-closing in {Math.max(0, 12 - seconds)}s
        </div>
      </div>
    </div>
  );
}
