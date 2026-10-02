"use client";

import { useCallback, useEffect, useState } from "react";
import { useAlpacaPositions } from "@/lib/positions-store";

interface Account {
  equity?: string;
  last_equity?: string;
  cash?: string;
  buying_power?: string;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Bottom strip: paper account balance + open positions, polled every 15s. */
export function PositionsBar() {
  const positions = useAlpacaPositions();
  const [account, setAccount] = useState<Account | null>(null);
  const [configured, setConfigured] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const accRes = await fetch("/api/alpaca/account");
      if (accRes.status === 501) {
        setConfigured(false);
        return;
      }
      const accBody = (await accRes.json()) as { data?: Account };
      if (accBody.data) setAccount(accBody.data);
    } catch {
      /* keep last known state on transient errors */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 15_000);
    const onOrders = () => refresh();
    window.addEventListener("alpaca-orders-changed", onOrders);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("alpaca-orders-changed", onOrders);
    };
  }, [refresh]);

  async function resetAccount() {
    if (
      !window.confirm(
        "Flatten paper account? This cancels all open orders and closes every position, returning the account to all cash.\n\nNote: Alpaca doesn't allow changing the balance via API — a true balance reset is done in the Alpaca dashboard and regenerates your API keys.",
      )
    ) {
      return;
    }
    setResetBusy(true);
    setResetMsg(null);
    try {
      const res = await fetch("/api/alpaca/reset", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Reset failed");
      setResetMsg("Account flattened — all orders cancelled, all positions closed.");
      await refresh();
    } catch (err) {
      setResetMsg(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetBusy(false);
    }
  }

  if (!configured) {
    return (
      <footer className="rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-500">
        Paper trading disabled — set APCA_API_KEY_ID and APCA_API_SECRET_KEY in .env.local
      </footer>
    );
  }

  const equity = account?.equity != null ? Number(account.equity) : null;
  const lastEquity = account?.last_equity != null ? Number(account.last_equity) : null;
  const cash = account?.cash != null ? Number(account.cash) : null;
  const buyingPower = account?.buying_power != null ? Number(account.buying_power) : null;
  const dayPl = equity != null && lastEquity != null ? equity - lastEquity : null;
  const totalPl = positions.reduce((acc, p) => acc + Number(p.unrealized_pl ?? 0), 0);
  // Day P&L minus what's still unrealized ≈ realized today (closed positions).
  const realizedPl = dayPl != null ? dayPl - totalPl : null;

  return (
    <footer className="rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs">
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
        <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-4 text-left">
          <span className="font-semibold text-neutral-300">Paper Trading</span>
          {equity != null && (
            <span className="font-mono text-neutral-300" title="Equity">
              E ${fmt(equity)}
            </span>
          )}
          {cash != null && (
            <span className="font-mono text-neutral-400" title="Cash">
              C ${fmt(cash)}
            </span>
          )}
          {buyingPower != null && (
            <span className="font-mono text-neutral-400" title="Buying power">
              BP ${fmt(buyingPower)}
            </span>
          )}
          {dayPl != null && (
            <span
              className={`font-mono ${dayPl >= 0 ? "text-green-400" : "text-red-400"}`}
              title="Day P&L (equity vs last close)"
            >
              Day {dayPl >= 0 ? "+" : ""}${fmt(dayPl)}
            </span>
          )}
          <span className="font-mono text-neutral-400">{positions.length} pos</span>
          <span className={`font-mono ${totalPl >= 0 ? "text-green-400" : "text-red-400"}`} title="Unrealized P&L (open positions)">
            uP&L {totalPl >= 0 ? "+" : ""}${fmt(totalPl)}
          </span>
          {realizedPl != null && (
            <span
              className={`font-mono ${realizedPl >= 0 ? "text-green-400" : "text-red-400"}`}
              title="Realized day P&L (≈ Day minus unrealized — closed trades today)"
            >
              rP&L {realizedPl >= 0 ? "+" : ""}${fmt(realizedPl)}
            </span>
          )}
          <span className="text-neutral-500">{expanded ? "▾" : "▸"}</span>
        </button>
        <button
          onClick={resetAccount}
          disabled={resetBusy}
          className="ml-auto rounded bg-red-800/70 px-2 py-0.5 text-[10px] font-semibold text-red-200 hover:bg-red-700 disabled:opacity-40"
          title="Cancel all orders and close all positions (Alpaca can't reset the balance via API)"
        >
          {resetBusy ? "Flattening…" : "Reset (flatten)"}
        </button>
      </div>
      {resetMsg && <div className="mt-1 text-[10px] text-amber-300">{resetMsg}</div>}
      {expanded && positions.length > 0 && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-neutral-800 pt-1.5 font-mono sm:grid-cols-4 lg:grid-cols-6">
          {positions.map((p) => {
            const pl = Number(p.unrealized_pl ?? 0);
            const plpc = Number(p.unrealized_plpc ?? 0) * 100;
            return (
              <div key={p.symbol} className="flex items-baseline gap-2">
                <span className="text-neutral-300">{p.symbol}</span>
                <span className="text-neutral-500">{p.qty}</span>
                <span className={pl >= 0 ? "text-green-400" : "text-red-400"}>
                  {pl >= 0 ? "+" : ""}
                  {plpc.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      {expanded && positions.length === 0 && (
        <div className="mt-1.5 border-t border-neutral-800 pt-1.5 text-neutral-500">
          No open positions — use a pane&apos;s Trade button to place a paper order.
        </div>
      )}
    </footer>
  );
}
