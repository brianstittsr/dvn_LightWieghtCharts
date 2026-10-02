"use client";

import { useState } from "react";
import { toAlpacaSymbol } from "@/lib/alpaca-symbol";
import { cn } from "@/lib/utils";

export interface TradeAlert {
  symbol: string;
  /** Suggested direction: high sweep → sell, low sweep → buy. */
  side: "buy" | "sell";
  reason: string;
  price: number;
}

interface TradeAlertDialogProps {
  alert: TradeAlert | null;
  onClose: () => void;
}

/** Modal popup shown when a session reversal fires — quick Alpaca order entry. */
export function TradeAlertDialog({ alert, onClose }: TradeAlertDialogProps) {
  const [qty, setQty] = useState("1");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [side, setSide] = useState<"buy" | "sell" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [lastAlert, setLastAlert] = useState<TradeAlert | null>(null);

  if (alert !== lastAlert) {
    setLastAlert(alert);
    setSide(alert?.side ?? null);
    setResult(null);
    setSubmitting(false);
    setTp("");
    setSl("");
  }
  if (!alert || !side) return null;

  const alpacaSym = toAlpacaSymbol(alert.symbol);
  const isCrypto = alpacaSym.includes("/"); // Alpaca doesn't support brackets on crypto
  const tpNum = tp.trim() ? Number(tp) : null;
  const slNum = sl.trim() ? Number(sl) : null;

  const submit = async () => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setResult("Enter a valid qty");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: alpacaSym,
          qty: q,
          side,
          type: "market",
          ...(tpNum != null && Number.isFinite(tpNum) ? { take_profit: tpNum } : {}),
          ...(slNum != null && Number.isFinite(slNum) ? { stop_loss: slNum } : {}),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setResult(body.error ?? "Order failed");
      } else {
        setResult(`Order submitted: ${side.toUpperCase()} ${q} ${alpacaSym}`);
        window.dispatchEvent(new Event("alpaca-orders-changed"));
        setTimeout(onClose, 1500);
      }
    } catch {
      setResult("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-80 rounded-lg border border-amber-500/50 bg-[#16181f] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Session reversal trade alert"
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-300">Session reversal</span>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300" aria-label="Dismiss">
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-neutral-400">{alert.reason}</p>
        <div className="mb-3 flex items-baseline justify-between rounded bg-neutral-800/60 px-2 py-1.5">
          <span className="font-mono text-sm text-neutral-100">{alpacaSym}</span>
          <span className="font-mono text-xs text-neutral-400">@ {alert.price.toFixed(2)}</span>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={cn(
                "rounded py-1.5 text-xs font-semibold uppercase",
                side === s
                  ? s === "buy"
                    ? "bg-green-600 text-white"
                    : "bg-red-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:text-neutral-200",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="mb-3 block text-[11px] text-neutral-400">
          Qty
          <input
            type="number"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 font-mono text-sm text-neutral-100 outline-none"
          />
        </label>
        {!isCrypto && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-neutral-400">
              Take profit <span className="text-neutral-600">(opt)</span>
              <input
                type="number"
                min="0"
                step="any"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                placeholder="price"
                className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-green-400 outline-none placeholder:text-neutral-600"
              />
            </label>
            <label className="block text-[11px] text-neutral-400">
              Stop loss <span className="text-neutral-600">(opt)</span>
              <input
                type="number"
                min="0"
                step="any"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                placeholder="price"
                className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-red-400 outline-none placeholder:text-neutral-600"
              />
            </label>
          </div>
        )}
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full rounded bg-amber-500 py-2 text-xs font-bold uppercase tracking-wide text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {submitting ? "Placing…" : `Place ${side} order`}
        </button>
        {result && (
          <p className={cn("mt-2 text-center text-[11px]", result.startsWith("Order") ? "text-green-400" : "text-red-400")}>
            {result}
          </p>
        )}
      </div>
    </div>
  );
}
