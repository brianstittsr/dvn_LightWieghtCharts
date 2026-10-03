"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { getCustomStrategies } from "@/lib/custom-strategies";
import { cn } from "@/lib/utils";

interface AlpacaBotEvent {
  t: string;
  type: "entry" | "exit" | "signal" | "error" | "info";
  msg: string;
  price?: number;
  size?: number;
  extras?: Record<string, number>;
}

interface AlpacaBot {
  id: string;
  name: string;
  symbol: string;
  assetClass: "stock" | "crypto";
  timeframe: string;
  qty: number;
  slPct: number;
  tpPct: number;
  strategy:
    | { kind: "ema-cross"; fastLen: number; slowLen: number }
    | { kind: "custom"; name: string; prompt: string; code: string; params: Record<string, number> };
  state: "stopped" | "running";
  events: AlpacaBotEvent[];
}

interface PositionView {
  side: "long" | "short" | null;
  qty: number;
  entry?: number;
  current?: number;
  unrealizedPl?: number;
}

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#1e222d] px-2.5 py-1.5 text-sm text-white";
const lbl =
  "mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500";
const btn =
  "rounded px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40";

export function AlpacaBots() {
  const [bots, setBots] = useState<AlpacaBot[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(() => {
    authFetch("/api/bots")
      .then((r) => r.json())
      .then((d) => setBots(d.data?.bots ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const bot = bots.find((b) => b.id === selected) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-56 flex-col border-r border-[#2a2e39]">
        <div className="flex items-center justify-between border-b border-[#2a2e39] px-3 py-2.5">
          <span className="text-xs font-semibold">Alpaca bots</span>
          <button
            onClick={() => setSelected("new")}
            className="rounded bg-[#2962ff] px-2 py-0.5 text-[10px] font-bold text-white"
          >
            + New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {bots.length === 0 && (
            <p className="p-3 text-[11px] text-gray-500">
              No stock/crypto bots yet — deploy one from a scanner hit or create
              one here.
            </p>
          )}
          {bots.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelected(b.id)}
              className={cn(
                "w-full border-b border-[#1e222d] px-3 py-2 text-left hover:bg-[#1e222d]",
                selected === b.id && "bg-[#1e222d]",
              )}
            >
              <p className="text-xs font-semibold">{b.name}</p>
              <p className="text-[10px] text-gray-500">
                {b.assetClass === "crypto" ? "₿" : "📈"} {b.symbol} · {b.timeframe} ·{" "}
                <span className={b.state === "running" ? "text-emerald-400" : "text-gray-500"}>
                  {b.state === "running" ? "● RUNNING" : "○ STOPPED"}
                </span>
              </p>
            </button>
          ))}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-4">
        {selected === "new" ? (
          <CreateForm
            onCreated={(id) => {
              setSelected(id);
              refresh();
            }}
            onError={setErr}
          />
        ) : bot ? (
          <BotDetail bot={bot} onChanged={refresh} onError={setErr} />
        ) : (
          <p className="py-16 text-center text-sm text-gray-500">
            Select a bot or create a new one.
          </p>
        )}
        {err && <p className="mt-3 text-xs text-red-400">{err}</p>}
      </main>
    </div>
  );
}

function CreateForm({
  onCreated,
  onError,
}: {
  onCreated: (id: string) => void;
  onError: (s: string) => void;
}) {
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<"stock" | "crypto">("stock");
  const [symbol, setSymbol] = useState("");
  const [timeframe, setTimeframe] = useState("5m");
  const [qty, setQty] = useState("1");
  const [slPct, setSlPct] = useState("2");
  const [tpPct, setTpPct] = useState("4");
  const [strategyKind, setStrategyKind] = useState<"ema-cross" | "custom">("ema-cross");
  const [fastLen, setFastLen] = useState("10");
  const [slowLen, setSlowLen] = useState("200");
  const [strategyId, setStrategyId] = useState("");
  const [busy, setBusy] = useState(false);

  const strategies = getCustomStrategies();

  const create = async () => {
    setBusy(true);
    onError("");
    try {
      const custom = strategies.find((s) => s.id === strategyId);
      const strategy =
        strategyKind === "ema-cross"
          ? { kind: "ema-cross" as const, fastLen: +fastLen, slowLen: +slowLen }
          : custom
            ? {
                kind: "custom" as const,
                name: custom.name,
                prompt: "",
                code: custom.code,
                params: Object.fromEntries(
                  custom.params.map((p) => [p.key, Number(p.default)]),
                ),
              }
            : null;
      if (!strategy) return onError("Pick a saved strategy (create one via Backtest → AI)");
      const res = await authFetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || `${symbol} ${strategy.kind === "ema-cross" ? `EMA ${fastLen}/${slowLen}` : "custom"}`,
          symbol: symbol.toUpperCase(),
          assetClass,
          timeframe,
          qty: +qty,
          slPct: +slPct,
          tpPct: +tpPct,
          strategy,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return onError(d.error ?? "Create failed");
      onCreated(d.data.bot.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md space-y-3">
      <h3 className="text-sm font-bold">New Alpaca bot</h3>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={lbl}>Asset class</span>
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as "stock" | "crypto")} className={sel}>
            <option value="stock">Stock</option>
            <option value="crypto">Crypto (long-only)</option>
          </select>
        </label>
        <label>
          <span className={lbl}>Symbol</span>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)}
            placeholder={assetClass === "crypto" ? "BTC" : "AMD"} className={sel} />
        </label>
        <label>
          <span className={lbl}>Bot name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto" className={sel} />
        </label>
        <label>
          <span className={lbl}>Timeframe</span>
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className={sel}>
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
          </select>
        </label>
        <label>
          <span className={lbl}>Qty</span>
          <input type="number" min={0.001} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className={sel} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className={lbl}>SL %</span>
            <input type="number" min={0} step={0.5} value={slPct} onChange={(e) => setSlPct(e.target.value)} className={sel} />
          </label>
          <label>
            <span className={lbl}>TP %</span>
            <input type="number" min={0} step={0.5} value={tpPct} onChange={(e) => setTpPct(e.target.value)} className={sel} />
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["ema-cross", "custom"] as const).map((k) => (
          <button key={k} onClick={() => setStrategyKind(k)}
            className={cn(
              "rounded border p-2 text-xs transition",
              strategyKind === k ? "border-[#2962ff] bg-[#2962ff] text-white" : "border-[#2a2e39] bg-[#1e222d] text-gray-300",
            )}>
            {k === "ema-cross" ? "EMA Crossover" : "Saved strategy"}
          </button>
        ))}
      </div>
      {strategyKind === "ema-cross" ? (
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className={lbl}>Fast EMA</span>
            <input type="number" min={1} value={fastLen} onChange={(e) => setFastLen(e.target.value)} className={sel} />
          </label>
          <label>
            <span className={lbl}>Slow EMA</span>
            <input type="number" min={2} value={slowLen} onChange={(e) => setSlowLen(e.target.value)} className={sel} />
          </label>
        </div>
      ) : (
        <label>
          <span className={lbl}>Strategy</span>
          <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={sel}>
            <option value="">— pick a saved AI strategy —</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>✨ {s.name}</option>
            ))}
          </select>
        </label>
      )}
      {assetClass === "crypto" && (
        <p className="text-[10px] text-amber-400">
          Alpaca crypto is long-only — short signals flatten the position.
          TP/SL is engine-managed (Alpaca can&apos;t bracket crypto orders).
        </p>
      )}
      <button onClick={create} disabled={busy || !symbol.trim()}
        className={cn(btn, "bg-[#1e7a3c] hover:bg-[#259a4b]")}>
        {busy ? "Creating…" : "Create bot"}
      </button>
    </div>
  );
}

function BotDetail({
  bot,
  onChanged,
  onError,
}: {
  bot: AlpacaBot;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [position, setPosition] = useState<PositionView | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPosition = useCallback(() => {
    authFetch(`/api/bots/${bot.id}`)
      .then((r) => r.json())
      .then((d) => setPosition(d.data?.position ?? null))
      .catch(() => {});
  }, [bot.id]);

  useEffect(() => {
    loadPosition();
    const t = setInterval(loadPosition, 5000);
    return () => clearInterval(t);
  }, [loadPosition]);

  const act = async (action: "start" | "stop" | "kill") => {
    setBusy(true);
    onError("");
    try {
      const res = await authFetch(`/api/bots/${bot.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return onError(d.error ?? `${action} failed`);
      onChanged();
      loadPosition();
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!window.confirm(`Delete bot "${bot.name}"?`)) return;
    await authFetch(`/api/bots/${bot.id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <h3 className="text-sm font-bold">{bot.name}</h3>
          <p className="text-[11px] text-gray-500">
            {bot.symbol} · {bot.timeframe} · qty {bot.qty} · SL {bot.slPct}% / TP {bot.tpPct}%
          </p>
        </div>
        <span
          className={cn(
            "ml-auto rounded px-2 py-0.5 text-[10px] font-bold",
            bot.state === "running" ? "bg-emerald-900/60 text-emerald-300" : "bg-neutral-800 text-gray-400",
          )}
        >
          {bot.state.toUpperCase()}
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        {bot.state === "running" ? (
          <button onClick={() => act("stop")} disabled={busy}
            className={cn(btn, "bg-amber-700 hover:bg-amber-600")}>
            ■ Stop trading
          </button>
        ) : (
          <button onClick={() => act("start")} disabled={busy}
            className={cn(btn, "bg-[#1e7a3c] hover:bg-[#259a4b]")}>
            ▶ Start trading
          </button>
        )}
        <button onClick={() => act("kill")} disabled={busy}
          className={cn(btn, "bg-[#a8323c] hover:bg-[#c03946]")}>
          ☠ Kill all positions
        </button>
        <button onClick={del} className={cn(btn, "ml-auto bg-neutral-700 hover:bg-neutral-600")}>
          Delete bot
        </button>
      </div>

      {/* Position monitor */}
      <div className="rounded-lg border border-[#2a2e39] bg-[#1e222d] p-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
            Position monitor
          </h4>
          <button onClick={loadPosition} className="text-[10px] text-gray-500 hover:text-gray-300">
            ⟳ Refresh
          </button>
        </div>
        {position?.side ? (
          <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
            <Stat label="Side" value={`${position.side === "long" ? "↗" : "↘"} ${position.side.toUpperCase()}`} />
            <Stat label="Qty" value={String(position.qty)} />
            <Stat label="Entry" value={position.entry?.toFixed(2) ?? "—"} />
            <Stat
              label="uP&L"
              value={
                position.unrealizedPl != null
                  ? `${position.unrealizedPl >= 0 ? "+" : ""}$${position.unrealizedPl.toFixed(2)}`
                  : "—"
              }
            />
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-gray-500">Flat — no open position.</p>
        )}
      </div>

      {/* Event log */}
      <div className="rounded-lg border border-[#2a2e39]">
        <h4 className="border-b border-[#2a2e39] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
          Trade event log
        </h4>
        <div className="max-h-64 overflow-y-auto">
          {bot.events.length === 0 && (
            <p className="p-3 text-[11px] text-gray-500">No events yet.</p>
          )}
          {bot.events.map((e, i) => (
            <div key={i} className="border-b border-[#1e222d] px-3 py-2 last:border-0">
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold text-white",
                    e.type === "entry" ? "bg-[#1e53e5]" :
                    e.type === "exit" ? "bg-[#7a4bc4]" :
                    e.type === "error" ? "bg-[#a8323c]" :
                    e.type === "signal" ? "bg-[#2a6b52]" : "bg-[#3a3f4b]",
                  )}
                >
                  {e.type === "signal" ? "SIGNAL DETECTED" : e.type.toUpperCase()}
                </span>
                <span className="text-[10px] text-gray-500">
                  {new Date(e.t).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-300">{e.msg}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 font-semibold text-white">{value}</p>
    </div>
  );
}
