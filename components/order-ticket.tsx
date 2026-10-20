"use client";

import { useCallback, useState } from "react";
import { toAlpacaSymbol } from "@/lib/alpaca-symbol";
import { symbolInfo } from "@/lib/symbols";
import { useAlpacaPositions } from "@/lib/positions-store";

interface OrderTicketProps {
  paneSymbol: string;
  lastPrice: number | null;
}

type Status = { kind: "ok" | "err"; text: string } | null;

interface Contract {
  symbol: string;
  expiration: string;
  strike: number;
  type: "call" | "put";
}

/** Alpaca reports crypto positions without the slash ("ETHUSD"). */
function normalize(sym: string): string {
  return sym.replace("/", "").toUpperCase();
}

async function submitOrder(payload: {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type?: "market" | "limit";
  limit_price?: number;
}): Promise<void> {
  const res = await fetch("/api/alpaca/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "market", ...payload, symbol: payload.symbol.toUpperCase() }),
  });
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Order failed (${res.status})`);
  window.dispatchEvent(new Event("alpaca-orders-changed"));
}

function OptionsTicket({ paneSymbol, lastPrice, onStatus }: { paneSymbol: string; lastPrice: number | null; onStatus: (s: Status) => void }) {
  const stockDefault = symbolInfo(paneSymbol).source === "alpaca" ? paneSymbol : "AAPL";
  const [underlying, setUnderlying] = useState(stockDefault);
  const [optType, setOptType] = useState<"call" | "put">("call");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [expiration, setExpiration] = useState("");
  const [contract, setContract] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!underlying.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/alpaca/options/contracts?underlying=${encodeURIComponent(underlying.trim())}&type=${optType}`,
      );
      const body = (await res.json()) as { data?: Contract[]; error?: string };
      if (!res.ok || !body.data) throw new Error(body.error ?? "Failed to load contracts");
      setContracts(body.data);
      setExpiration("");
      setContract("");
    } catch (err) {
      onStatus({ kind: "err", text: err instanceof Error ? err.message : "Contracts failed" });
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, [underlying, optType, onStatus]);

  const expirations = [...new Set(contracts.map((c) => c.expiration))].sort();
  const strikes = contracts
    .filter((c) => c.expiration === expiration)
    .sort((a, b) => {
      // Nearest strikes to last price first for easy picking.
      const ref = lastPrice ?? 0;
      return Math.abs(a.strike - ref) - Math.abs(b.strike - ref);
    })
    .slice(0, 25)
    .sort((a, b) => a.strike - b.strike);

  async function submit(side: "buy" | "sell") {
    const q = Number(qty);
    if (!contract || !(q > 0)) {
      onStatus({ kind: "err", text: "Pick a contract and qty > 0" });
      return;
    }
    setBusy(true);
    onStatus(null);
    try {
      await submitOrder({ symbol: contract, qty: q, side });
      onStatus({ kind: "ok", text: `${side.toUpperCase()} ${q}× ${contract} submitted` });
    } catch (err) {
      onStatus({ kind: "err", text: err instanceof Error ? err.message : "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-auto flex flex-wrap items-center gap-1.5">
      <input
        value={underlying}
        onChange={(e) => setUnderlying(e.target.value)}
        className="w-16 rounded bg-neutral-800 px-1.5 py-1 font-mono text-xs uppercase text-neutral-200 outline-none"
        aria-label="Underlying"
        title="Underlying stock symbol"
      />
      <div className="flex overflow-hidden rounded border border-neutral-700">
        {(["call", "put"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setOptType(t)}
            className={`px-1.5 py-1 text-[10px] font-semibold uppercase ${
              optType === t
                ? t === "call"
                  ? "bg-green-700 text-white"
                  : "bg-red-700 text-white"
                : "bg-neutral-800 text-neutral-400"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <button
        onClick={load}
        disabled={loading}
        className="rounded bg-neutral-700 px-1.5 py-1 text-[10px] text-neutral-200 hover:bg-neutral-600 disabled:opacity-40"
      >
        {loading ? "…" : "Chain"}
      </button>
      {expirations.length > 0 && (
        <>
          <select
            value={expiration}
            onChange={(e) => {
              setExpiration(e.target.value);
              setContract("");
            }}
            className="rounded bg-neutral-800 px-1 py-1 text-xs text-neutral-200"
            aria-label="Expiration"
          >
            <option value="">exp…</option>
            {expirations.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          {expiration && (
            <select
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              className="max-w-28 rounded bg-neutral-800 px-1 py-1 text-xs text-neutral-200"
              aria-label="Strike"
            >
              <option value="">strike…</option>
              {strikes.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.strike}
                </option>
              ))}
            </select>
          )}
          {contract && (
            <>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                type="number"
                min="1"
                step="1"
                className="w-12 rounded bg-neutral-800 px-1.5 py-1 font-mono text-xs text-neutral-200 outline-none"
                aria-label="Contracts"
                title="Number of contracts"
              />
              <button
                onClick={() => submit("buy")}
                disabled={busy}
                className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-40"
              >
                Buy
              </button>
              <button
                onClick={() => submit("sell")}
                disabled={busy}
                className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
              >
                Sell
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Partial-close a position via Alpaca. */
async function partialClose(symbol: string, closeQty: number): Promise<void> {
  const res = await fetch(
    `/api/alpaca/positions?symbol=${encodeURIComponent(symbol.toUpperCase())}&qty=${closeQty}`,
    { method: "DELETE" },
  );
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Partial close failed (${res.status})`);
  window.dispatchEvent(new Event("alpaca-orders-changed"));
}

/** Per-pane trading ticket: equity/crypto orders + options orders via Alpaca. */
export function OrderTicket({ paneSymbol, lastPrice }: OrderTicketProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"equity" | "options">("equity");
  const [symbol, setSymbol] = useState(toAlpacaSymbol(paneSymbol));
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [partialQty, setPartialQty] = useState("1");
  /** Risk:Reward ratio — e.g. "2" means reward = 2× the risk distance. */
  const [rrRatio, setRrRatio] = useState("2");
  /** Stop-loss distance from entry in dollar terms. */
  const [slDistance, setSlDistance] = useState("1");
  const [showRr, setShowRr] = useState(false);
  const positions = useAlpacaPositions();

  // Re-sync editable symbol when the pane symbol changes.
  const [prevPane, setPrevPane] = useState(paneSymbol);
  if (paneSymbol !== prevPane) {
    setPrevPane(paneSymbol);
    setSymbol(toAlpacaSymbol(paneSymbol));
  }

  const held = positions.find((p) => normalize(p.symbol) === normalize(symbol));
  const heldQty = held ? Number(held.qty) : 0;
  const isCrypto = symbol.includes("/");
  const sellQty = Number(qty);
  // Crypto can't be shorted on Alpaca; stocks can, so only block crypto sells.
  const sellBlocked = isCrypto && sellQty > heldQty;

  const rr = Number(rrRatio) || 2;
  const slDist = Number(slDistance) || 0;
  const tpDist = slDist * rr;

  async function submit(side: "buy" | "sell") {
    const q = Number(qty);
    if (!symbol.trim() || !(q > 0)) {
      setStatus({ kind: "err", text: "Enter a symbol and qty > 0" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      // Build bracket payload when R:R is active and we have a valid SL distance + price
      const payload: {
        symbol: string;
        qty: number;
        side: "buy" | "sell";
        type?: "market" | "limit";
        take_profit?: { limit_price: number };
        stop_loss?: { stop_price: number };
      } = { symbol: symbol.trim(), qty: q, side };

      if (showRr && slDist > 0 && lastPrice != null) {
        if (side === "buy") {
          payload.stop_loss = { stop_price: Math.round((lastPrice - slDist) * 100) / 100 };
          payload.take_profit = { limit_price: Math.round((lastPrice + tpDist) * 100) / 100 };
        } else {
          payload.stop_loss = { stop_price: Math.round((lastPrice + slDist) * 100) / 100 };
          payload.take_profit = { limit_price: Math.round((lastPrice - tpDist) * 100) / 100 };
        }
      }

      await submitOrder(payload);
      setStatus({ kind: "ok", text: `${side.toUpperCase()} ${q} ${symbol.toUpperCase()} submitted` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  async function doPartialClose() {
    const pq = Number(partialQty);
    if (!symbol.trim() || !(pq > 0)) {
      setStatus({ kind: "err", text: "Set symbol and partial qty > 0" });
      return;
    }
    if (pq > heldQty) {
      setStatus({ kind: "err", text: `Only ${heldQty} held — can't close ${pq}` });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await partialClose(symbol.trim(), pq);
      setStatus({ kind: "ok", text: `Closed ${pq} ${symbol.toUpperCase()}` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : "Partial close failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="ml-auto rounded bg-emerald-700/60 px-2 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-600/60"
      >
        Trade
      </button>
    );
  }

  return (
    <div className="ml-auto flex flex-wrap items-center gap-1.5">
      <div className="flex overflow-hidden rounded border border-neutral-700">
        {(["equity", "options"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-1.5 py-1 text-[10px] font-semibold capitalize ${
              mode === m ? "bg-blue-600 text-white" : "bg-neutral-800 text-neutral-400"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "equity" ? (
        <>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-20 rounded bg-neutral-800 px-1.5 py-1 font-mono text-xs uppercase text-neutral-200 outline-none"
            aria-label="Order symbol"
            title="Alpaca symbol (US stocks or crypto like BTC/USD)"
          />
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="number"
            min="0"
            step="any"
            className="w-14 rounded bg-neutral-800 px-1.5 py-1 font-mono text-xs text-neutral-200 outline-none"
            aria-label="Quantity"
          />
          {heldQty > 0 && (
            <span className="font-mono text-[10px] text-neutral-500" title="Position held">
              held {heldQty}
            </span>
          )}
          {/* Go Long / Go Short */}
          <button
            onClick={() => submit("buy")}
            disabled={busy}
            className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-40"
            title="Go Long — buy"
          >
            Go Long
          </button>
          <button
            onClick={() => submit("sell")}
            disabled={busy || sellBlocked}
            title={sellBlocked ? `Only ${heldQty} ${symbol} held — crypto can't be shorted` : "Go Short — sell"}
            className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
          >
            Go Short
          </button>
          {/* Partial close */}
          {heldQty > 0 && (
            <>
              <input
                value={partialQty}
                onChange={(e) => setPartialQty(e.target.value)}
                type="number"
                min="1"
                max={heldQty}
                className="w-12 rounded bg-neutral-800 px-1 py-1 font-mono text-xs text-neutral-200 outline-none"
                aria-label="Partial close qty"
                title="Quantity to close"
              />
              <button
                onClick={doPartialClose}
                disabled={busy}
                className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
                title="Partially close position"
              >
                Close {partialQty}
              </button>
            </>
          )}
          {/* Risk:Reward toggle */}
          <button
            onClick={() => setShowRr((v) => !v)}
            className={`rounded px-1.5 py-1 text-[10px] font-semibold ${
              showRr ? "bg-blue-600 text-white" : "bg-neutral-800 text-neutral-400"
            }`}
            title="Toggle risk:reward ratio"
          >
            R:R
          </button>
          {showRr && (
            <>
              <span className="text-[10px] text-neutral-500">SL$</span>
              <input
                value={slDistance}
                onChange={(e) => setSlDistance(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="w-12 rounded bg-neutral-800 px-1 py-1 font-mono text-xs text-neutral-200 outline-none"
                aria-label="Stop loss distance"
                title="Stop-loss distance from entry ($)"
              />
              <span className="text-[10px] text-neutral-500">R:R</span>
              <input
                value={rrRatio}
                onChange={(e) => setRrRatio(e.target.value)}
                type="number"
                min="0.1"
                step="0.1"
                className="w-10 rounded bg-neutral-800 px-1 py-1 font-mono text-xs text-neutral-200 outline-none"
                aria-label="Risk reward ratio"
                title="Risk:reward ratio — TP = SL × R:R"
              />
              {slDist > 0 && (
                <span className="font-mono text-[10px] text-emerald-400" title="Take profit distance">
                  TP=${tpDist.toFixed(2)}
                </span>
              )}
            </>
          )}
        </>
      ) : (
        <OptionsTicket paneSymbol={paneSymbol} lastPrice={lastPrice} onStatus={setStatus} />
      )}

      {lastPrice != null && (
        <span className="hidden font-mono text-[10px] text-neutral-500 xl:inline">
          ~{lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      )}
      <button
        onClick={() => setOpen(false)}
        className="text-xs text-neutral-500 hover:text-neutral-300"
        aria-label="Close ticket"
      >
        ✕
      </button>
      {status && (
        <span className={`text-[10px] ${status.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
          {status.text}
        </span>
      )}
    </div>
  );
}
