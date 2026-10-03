"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { BotEvent, FuturesBot } from "@/lib/futures-bots";
import { cn } from "@/lib/utils";

interface Platform {
  id: string;
  configured: boolean;
  accounts: { id: number; name: string; balance: number }[];
  linkedAccountId?: number;
}
interface Contract {
  id: string;
  name: string;
  description: string;
}

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-[#2962ff]";
const lbl = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500";
const btn = "rounded px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40";

export function FuturesBots({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [bots, setBots] = useState<(FuturesBot & { running?: boolean })[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(() => {
    if (!open) return;
    authFetch("/api/futures/bots")
      .then((r) => r.json())
      .then((d) => setBots(d.data?.bots ?? []))
      .catch(() => {});
    authFetch("/api/futures/status")
      .then((r) => r.json())
      .then((d) => setPlatforms(d.data?.platforms ?? []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!open) return null;
  const bot = bots.find((b) => b.id === selected) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <aside className="flex w-56 flex-col border-r border-[#2a2e39]">
          <div className="flex items-center justify-between border-b border-[#2a2e39] px-3 py-3">
            <h2 className="text-sm font-bold text-white">Futures Bots</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {bots.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className={cn(
                  "block w-full border-b border-[#1e222d] px-3 py-2.5 text-left",
                  selected === b.id ? "bg-[#1c2333]" : "hover:bg-[#171c26]",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", b.running ? "bg-emerald-400" : "bg-gray-600")} />
                  <span className="truncate text-sm text-white">{b.name}</span>
                </div>
                <div className="mt-0.5 truncate pl-4 text-[11px] text-gray-500">
                  {b.strategy.kind === "ema-cross"
                    ? `EMA ${b.strategy.fastLen}/${b.strategy.slowLen} cross`
                    : `AI: ${b.strategy.name}`}{" "}
                  · {b.contractName ?? b.contractId} · {b.timeframe}
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelected("new")}
            className="border-t border-[#2a2e39] px-3 py-2.5 text-left text-sm text-[#2962ff] hover:bg-[#171c26]"
          >
            + New bot
          </button>
        </aside>

        {/* Main panel */}
        <main className="flex-1 overflow-y-auto p-4">
          {selected === "new" ? (
            <BotForm
              platforms={platforms}
              onCreated={(id) => {
                setSelected(id);
                refresh();
              }}
              onError={setErr}
            />
          ) : bot ? (
            <BotDetail bot={bot} onChanged={refresh} onError={setErr} onDeleted={() => { setSelected(null); refresh(); }} />
          ) : (
            <p className="py-16 text-center text-sm text-gray-500">
              Select a bot or create a new one.
            </p>
          )}
          {err && <p className="mt-3 text-xs text-red-400">{err}</p>}
        </main>
      </div>
    </div>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────

function BotDetail({
  bot,
  onChanged,
  onError,
  onDeleted,
}: {
  bot: FuturesBot & { running?: boolean };
  onChanged: () => void;
  onError: (s: string) => void;
  onDeleted: () => void;
}) {
  const [edit, setEdit] = useState({
    size: bot.size,
    slPoints: bot.slPoints,
    tpPoints: bot.tpPoints,
    timeframe: bot.timeframe,
    fastLen: bot.strategy.kind === "ema-cross" ? bot.strategy.fastLen : 10,
    slowLen: bot.strategy.kind === "ema-cross" ? bot.strategy.slowLen : 200,
    initialFast: bot.strategy.kind === "ema-cross" ? (bot.strategy.initialFast ?? "") : "",
    initialSlow: bot.strategy.kind === "ema-cross" ? (bot.strategy.initialSlow ?? "") : "",
    prompt: bot.strategy.kind === "custom" ? bot.strategy.prompt : "",
    code: bot.strategy.kind === "custom" ? bot.strategy.code : "",
  });
  const [busy, setBusy] = useState("");

  interface Mon {
    position: { side: "long" | "short"; size: number; averagePrice: number } | null;
    last: number | null;
    tickSize: number | null;
    tickValue: number | null;
    balance: number | null;
  }
  const [mon, setMon] = useState<Mon | null>(null);

  const refreshMon = useCallback(() => {
    authFetch(`/api/futures/bots/${bot.id}/position`)
      .then((r) => r.json())
      .then((d) => setMon(d.data ?? null))
      .catch(() => {});
  }, [bot.id]);

  useEffect(() => {
    refreshMon();
    const t = setInterval(refreshMon, 5000);
    return () => clearInterval(t);
  }, [refreshMon]);

  const act = async (action: string) => {
    setBusy(action);
    onError("");
    try {
      const res = await authFetch(`/api/futures/bots/${bot.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) onError(d.error ?? `${action} failed`);
      onChanged();
    } finally {
      setBusy("");
    }
  };

  const saveParams = async () => {
    setBusy("save");
    onError("");
    try {
      const body: Record<string, unknown> = {
        size: edit.size,
        slPoints: edit.slPoints,
        tpPoints: edit.tpPoints,
        timeframe: edit.timeframe,
      };
      if (bot.strategy.kind === "ema-cross") {
        body.strategy = {
          kind: "ema-cross",
          fastLen: edit.fastLen,
          slowLen: edit.slowLen,
          initialFast: edit.initialFast === "" ? undefined : Number(edit.initialFast),
          initialSlow: edit.initialSlow === "" ? undefined : Number(edit.initialSlow),
        };
      } else {
        body.strategy = { ...bot.strategy, prompt: edit.prompt, code: edit.code };
      }
      const res = await authFetch(`/api/futures/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) onError(d.error ?? "Save failed");
      onChanged();
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete bot "${bot.name}"?`)) return;
    await authFetch(`/api/futures/bots?id=${bot.id}`, { method: "DELETE" });
    onDeleted();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white">{bot.name}</h3>
          <p className="text-xs text-gray-500">
            {bot.contractName ?? bot.contractId} · {bot.platform} ·{" "}
            <span className={bot.running ? "text-emerald-400" : "text-gray-500"}>
              {bot.running ? "RUNNING" : "STOPPED"}
            </span>
          </p>
        </div>
        <button onClick={remove} className={cn(btn, "bg-[#3a3f4b] hover:bg-[#4a505e]")}>Delete</button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500">
          {mon?.position ? `${mon.position.size} Position` : "0 Positions"}
        </span>
        <button
          disabled={Boolean(busy) || bot.running}
          onClick={() => act("start")}
          className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}
        >
          ▶ Start Trading
        </button>
        <button
          disabled={Boolean(busy) || !bot.running}
          onClick={() => act("stop")}
          className={cn(btn, "bg-[#3a3f4b] hover:bg-[#4a505e]")}
        >
          ■ Stop Trading
        </button>
        <button
          disabled={Boolean(busy)}
          onClick={() => act("kill")}
          className={cn(btn, "bg-[#a8323c] hover:bg-[#c43d49]")}
        >
          Kill All Positions
        </button>
        <span className="ml-auto text-xs text-gray-500">
          {mon?.balance != null && `Balance $${mon.balance.toLocaleString()}`}
        </span>
      </div>

      {/* Position monitor */}
      <section className="rounded border border-[#2a2e39] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-white">
            Position Monitor{" "}
            {mon?.position && (
              <span className="ml-1 rounded bg-[#a8323c] px-1.5 py-0.5 text-[10px] font-bold">
                OPEN POSITION
              </span>
            )}
          </h4>
          <button onClick={refreshMon} className="text-[11px] text-gray-400 hover:text-white">
            Refresh
          </button>
        </div>
        {mon?.position ? (
          <PositionCard bot={bot} mon={mon} onClose={refreshMon} />
        ) : (
          <p className="py-3 text-center text-xs text-gray-500">
            No open position on this contract
          </p>
        )}
      </section>

      {/* Parameters */}
      <section className="rounded border border-[#2a2e39] p-3">
        <h4 className="mb-2 text-xs font-semibold text-white">Strategy Parameters</h4>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[11px] text-gray-400">
            Contracts
            <input type="number" min={1} value={edit.size}
              onChange={(e) => setEdit({ ...edit, size: +e.target.value })} className={cn(sel, "mt-1")} />
          </label>
          <label className="text-[11px] text-gray-400">
            Timeframe
            <select value={edit.timeframe}
              onChange={(e) => setEdit({ ...edit, timeframe: e.target.value as typeof edit.timeframe })}
              className={cn(sel, "mt-1")}>
              <option value="30s">30 Seconds</option>
              <option value="1m">1 Minute</option>
              <option value="5m">5 Minutes</option>
              <option value="15m">15 Minutes</option>
              <option value="1h">1 Hour</option>
            </select>
          </label>
          <div />
          <label className="text-[11px] text-gray-400">
            Stop Loss (points)
            <input type="number" step="any" value={edit.slPoints}
              onChange={(e) => setEdit({ ...edit, slPoints: +e.target.value })} className={cn(sel, "mt-1")} />
          </label>
          <label className="text-[11px] text-gray-400">
            Take Profit (points)
            <input type="number" step="any" value={edit.tpPoints}
              onChange={(e) => setEdit({ ...edit, tpPoints: +e.target.value })} className={cn(sel, "mt-1")} />
          </label>
        </div>

        {bot.strategy.kind === "ema-cross" && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            <label className="text-[11px] text-gray-400">
              Fast EMA
              <input type="number" min={1} value={edit.fastLen}
                onChange={(e) => setEdit({ ...edit, fastLen: +e.target.value })} className={cn(sel, "mt-1")} />
            </label>
            <label className="text-[11px] text-gray-400">
              Slow EMA
              <input type="number" min={2} value={edit.slowLen}
                onChange={(e) => setEdit({ ...edit, slowLen: +e.target.value })} className={cn(sel, "mt-1")} />
            </label>
            <label className="text-[11px] text-gray-400">
              Initial fast EMA (opt)
              <input type="number" step="any" value={edit.initialFast}
                onChange={(e) => setEdit({ ...edit, initialFast: e.target.value === "" ? "" : +e.target.value })}
                className={cn(sel, "mt-1")} />
            </label>
            <label className="text-[11px] text-gray-400">
              Initial slow EMA (opt)
              <input type="number" step="any" value={edit.initialSlow}
                onChange={(e) => setEdit({ ...edit, initialSlow: e.target.value === "" ? "" : +e.target.value })}
                className={cn(sel, "mt-1")} />
            </label>
          </div>
        )}

        {bot.strategy.kind === "custom" && (
          <div className="mt-3 space-y-2">
            <label className={lbl}>
              Strategy prompt
              <textarea value={edit.prompt} rows={2}
                onChange={(e) => setEdit({ ...edit, prompt: e.target.value })}
                className={cn(sel, "mt-1 normal-case")} />
            </label>
            <label className={lbl}>
              Generated code
              <textarea value={edit.code} rows={5}
                onChange={(e) => setEdit({ ...edit, code: e.target.value })}
                className={cn(sel, "mt-1 font-mono text-xs normal-case")} />
            </label>
          </div>
        )}

        <button onClick={saveParams} disabled={Boolean(busy)}
          className={cn(btn, "mt-3 bg-[#2962ff] hover:bg-[#1e53e5]")}>
          Update Parameters
        </button>
      </section>

      {/* Event log */}
      <section className="rounded border border-[#2a2e39]">
        <h4 className="border-b border-[#2a2e39] px-3 py-2 text-xs font-semibold text-white">
          Trade Event Log
        </h4>
        <div className="max-h-56 overflow-y-auto">
          {bot.events.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-gray-500">No events yet</p>
          ) : (
            bot.events.map((e, i) => <EventCard key={i} e={e} />)
          )}
        </div>
      </section>
    </div>
  );
}

function PositionCard({
  bot,
  mon,
  onClose,
}: {
  bot: FuturesBot;
  mon: {
    position: { side: "long" | "short"; size: number; averagePrice: number } | null;
    last: number | null;
    tickSize: number | null;
    tickValue: number | null;
    balance: number | null;
  };
  onClose: () => void;
}) {
  const p = mon.position!;
  const dir = p.side === "long" ? 1 : -1;
  const entry = p.averagePrice;
  const cur = mon.last;
  const sl = entry - dir * bot.slPoints;
  const tp = entry + dir * bot.tpPoints;
  const pnl =
    cur != null && mon.tickSize && mon.tickValue
      ? ((cur - entry) * dir * p.size * mon.tickValue) / mon.tickSize
      : null;

  const close = async () => {
    await authFetch("/api/futures/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: bot.platform,
        accountId: bot.accountId,
        action: "close",
        contractId: bot.contractId,
      }),
    });
    onClose();
  };

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
      <div className="col-span-2 mb-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">
          Bot tracked position
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold text-white",
            p.side === "long" ? "bg-[#1e7a3c]" : "bg-[#a8323c]",
          )}
        >
          {p.side === "long" ? "↗ BUY" : "↘ SELL"} {p.size}
        </span>
        <button
          onClick={close}
          className="ml-auto rounded bg-[#a8323c] px-2 py-0.5 text-[10px] font-bold text-white hover:bg-[#c43d49]"
        >
          Close
        </button>
      </div>
      <div>
        <span className="text-gray-500">Entry price</span>
        <p className="text-sm text-white">{fmt(entry)}</p>
      </div>
      <div>
        <span className="text-gray-500">Current price</span>
        <p className="text-sm text-white">{cur != null ? fmt(cur) : "—"}</p>
      </div>
      <div>
        <span className="text-gray-500">Stop loss</span>
        <p className="text-sm text-red-400">{bot.slPoints > 0 ? fmt(sl) : "—"}</p>
      </div>
      <div>
        <span className="text-gray-500">Take profit</span>
        <p className="text-sm text-emerald-400">{bot.tpPoints > 0 ? fmt(tp) : "—"}</p>
      </div>
      <div className="col-span-2">
        <span className="text-gray-500">Current P&L</span>
        <p
          className={cn(
            "text-base font-bold",
            pnl == null ? "text-gray-400" : pnl >= 0 ? "text-emerald-400" : "text-red-400",
          )}
        >
          {pnl != null ? `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}` : "—"}
        </p>
      </div>
    </div>
  );
}

function EventCard({ e }: { e: BotEvent }) {
  const color =
    e.type === "entry" ? "bg-[#1e53e5]" :
    e.type === "exit" ? "bg-[#7a4bc4]" :
    e.type === "error" ? "bg-[#a8323c]" :
    e.type === "signal" ? "bg-[#2a6b52]" : "bg-[#3a3f4b]";
  const label = e.type === "signal" ? "SIGNAL DETECTED" : e.type.toUpperCase();
  return (
    <div className="border-b border-[#1e222d] px-3 py-2 last:border-0">
      <div className="flex items-center justify-between">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold text-white", color)}>
          {label}
        </span>
        <span className="text-[10px] text-gray-500">
          {new Date(e.t).toLocaleString()}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-300">{e.msg}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-gray-500">
        {e.price != null && <span>Price {e.price.toLocaleString()}</span>}
        {e.size != null && <span>Contracts {e.size}</span>}
        {Object.entries(e.extras ?? {}).map(([k, v]) => (
          <span key={k}>{k} {Number.isFinite(v) ? v.toFixed(2) : v}</span>
        ))}
      </div>
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

function BotForm({
  platforms,
  onCreated,
  onError,
}: {
  platforms: Platform[];
  onCreated: (id: string) => void;
  onError: (s: string) => void;
}) {
  const configured = platforms.filter((p) => p.configured);
  const [name, setName] = useState("");
  const [platformSel, setPlatformSel] = useState("");
  const [accountSel, setAccountSel] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("MNQ");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState("");
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h">("5m");
  const [size, setSize] = useState(1);
  const [slPoints, setSlPoints] = useState("80");
  const [tpPoints, setTpPoints] = useState("10");
  const [fastLen, setFastLen] = useState("10");
  const [slowLen, setSlowLen] = useState("200");
  const [seedFast, setSeedFast] = useState("");
  const [seedSlow, setSeedSlow] = useState("");
  const [strategyKind, setStrategyKind] = useState<"ema-cross" | "custom">("ema-cross");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [generated, setGenerated] = useState<{
    name: string; description?: string; code: string; params: Record<string, number>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Derived defaults — first configured platform + its pinned/first account.
  const platform =
    platformSel || configured.find((p) => p.accounts.length > 0)?.id || "";
  const plat = platforms.find((p) => p.id === platform);
  const accountId =
    accountSel ?? plat?.linkedAccountId ?? plat?.accounts[0]?.id ?? null;

  // Contract search (debounced).
  useEffect(() => {
    if (!platform) return;
    const t = setTimeout(() => {
      authFetch(`/api/futures/contracts?platform=${platform}&q=${encodeURIComponent(searchQ)}`)
        .then((r) => r.json())
        .then((d) => {
          const list: Contract[] = d.data?.contracts ?? [];
          setContracts(list);
          if (!list.find((c) => c.id === contractId) && list.length) setContractId(list[0].id);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [platform, searchQ, contractId]);

  const generate = async () => {
    setAiBusy(true);
    setAiErr("");
    try {
      const res = await fetch("/api/ai-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: aiPrompt,
          answers: questions ? answers : undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setAiErr(d.error ?? "Generation failed");
      if (d.data?.questions) {
        setQuestions(d.data.questions);
        setAnswers(d.data.questions.map(() => ""));
        return;
      }
      const params: Record<string, number> = {};
      for (const p of d.data?.params ?? []) params[p.name] = p.value;
      setGenerated({ name: d.data.name, description: d.data.description, code: d.data.code, params });
      if (!name) setName(d.data.name);
    } finally {
      setAiBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    onError("");
    try {
      const contract = contracts.find((c) => c.id === contractId);
      const strategy =
        strategyKind === "ema-cross"
          ? {
              kind: "ema-cross" as const,
              fastLen: +fastLen,
              slowLen: +slowLen,
              initialFast: seedFast === "" ? undefined : +seedFast,
              initialSlow: seedSlow === "" ? undefined : +seedSlow,
            }
          : {
              kind: "custom" as const,
              name: generated?.name ?? "Custom",
              prompt: aiPrompt,
              code: generated?.code ?? "",
              params: generated?.params ?? {},
            };
      const res = await authFetch("/api/futures/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Futures bot",
          platform,
          accountId: accountId ?? undefined,
          contractId,
          contractName: contract?.name,
          timeframe,
          size,
          slPoints: +slPoints,
          tpPoints: +tpPoints,
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

  if (configured.length === 0) {
    return (
      <p className="rounded border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-300">
        No futures account linked. Add a TopStep/Apex account in <strong>Admin →
        Trading accounts</strong> first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-bold text-white">New bot</h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-gray-400">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="MNQ EMA Crossover" className={cn(sel, "mt-1")} />
        </label>
        <label className="text-[11px] text-gray-400">
          Platform
          <select value={platform}
            onChange={(e) => {
              setPlatformSel(e.target.value);
              setAccountSel(null); // reset → derived pin/first account kicks in
            }}
            className={cn(sel, "mt-1")}>
            {configured.map((p) => (
              <option key={p.id} value={p.id}>{p.id === "topstep" ? "TopStep" : "Apex"}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-400">
          Account
          <select value={accountId ?? ""}
            onChange={(e) => setAccountSel(Number(e.target.value))} className={cn(sel, "mt-1")}>
            {(plat?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name} · ${a.balance.toLocaleString()}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-400">
          Contract
          <div className="mt-1 flex gap-1.5">
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value.toUpperCase())}
              className={cn(sel, "w-20")} aria-label="Contract search" />
            <select value={contractId} onChange={(e) => setContractId(e.target.value)} className={sel}>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.description}</option>
              ))}
            </select>
          </div>
        </label>
        <label className="text-[11px] text-gray-400">
          Contracts
          <input type="number" min={1} value={size}
            onChange={(e) => setSize(Math.max(1, +e.target.value || 1))} className={cn(sel, "mt-1")} />
        </label>
        <label className="text-[11px] text-gray-400">
          Timeframe
          <select value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as typeof timeframe)} className={cn(sel, "mt-1")}>
            <option value="30s">30 Seconds</option>
              <option value="1m">1 Minute</option>
            <option value="5m">5 Minutes</option>
            <option value="15m">15 Minutes</option>
            <option value="1h">1 Hour</option>
          </select>
        </label>
        <label className="text-[11px] text-gray-400">
          Stop Loss (points)
          <input type="number" step="any" value={slPoints}
            onChange={(e) => setSlPoints(e.target.value)} className={cn(sel, "mt-1")} />
        </label>
        <label className="text-[11px] text-gray-400">
          Take Profit (points)
          <input type="number" step="any" value={tpPoints}
            onChange={(e) => setTpPoints(e.target.value)} className={cn(sel, "mt-1")} />
        </label>
      </div>

      {/* Strategy */}
      <div className="rounded border border-[#2a2e39] p-3">
        <div className="mb-2 flex gap-2">
          {(["ema-cross", "custom"] as const).map((k) => (
            <button key={k} onClick={() => setStrategyKind(k)}
              className={cn(btn, strategyKind === k ? "bg-[#2962ff]" : "bg-[#3a3f4b]")}>
              {k === "ema-cross" ? "EMA Crossover" : "AI generated"}
            </button>
          ))}
        </div>

        {strategyKind === "ema-cross" ? (
          <div className="grid grid-cols-4 gap-2">
            <label className="text-[11px] text-gray-400">
              Fast EMA
              <input type="number" min={1} value={fastLen}
                onChange={(e) => setFastLen(e.target.value)} className={cn(sel, "mt-1")} />
            </label>
            <label className="text-[11px] text-gray-400">
              Slow EMA
              <input type="number" min={2} value={slowLen}
                onChange={(e) => setSlowLen(e.target.value)} className={cn(sel, "mt-1")} />
            </label>
            <label className="text-[11px] text-gray-400">
              Initial fast (opt)
              <input type="number" step="any" value={seedFast}
                onChange={(e) => setSeedFast(e.target.value)} className={cn(sel, "mt-1")} />
            </label>
            <label className="text-[11px] text-gray-400">
              Initial slow (opt)
              <input type="number" step="any" value={seedSlow}
                onChange={(e) => setSeedSlow(e.target.value)} className={cn(sel, "mt-1")} />
            </label>
            <p className="col-span-4 text-[10px] text-gray-600">
              Seed values skip the warmup wait — starts immediately when both are set.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={2}
              placeholder="Describe the strategy — e.g. long when 10 EMA crosses above 200 EMA, exit on opposite cross"
              className={cn(sel, "text-sm")}
            />
            {questions && (
              <div className="space-y-1.5">
                {questions.map((q, i) => (
                  <label key={i} className="block text-[11px] text-gray-400">
                    {q}
                    <input value={answers[i] ?? ""}
                      onChange={(e) => {
                        const a = [...answers];
                        a[i] = e.target.value;
                        setAnswers(a);
                      }}
                      className={cn(sel, "mt-0.5")} />
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={generate} disabled={aiBusy || !aiPrompt.trim()}
                className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}>
                {aiBusy ? "Generating…" : questions ? "Generate with answers" : "Generate strategy"}
              </button>
              {questions && (
                <button onClick={() => setQuestions(null)} className="text-[11px] text-gray-500 hover:text-gray-300">
                  start over
                </button>
              )}
            </div>
            {aiErr && <p className="text-xs text-red-400">{aiErr}</p>}
            {generated && (
              <p className="rounded border border-emerald-700/40 bg-emerald-900/20 px-2 py-1.5 text-[11px] text-emerald-300">
                Generated: <strong>{generated.name}</strong>
                {generated.description ? ` — ${generated.description}` : ""}
              </p>
            )}
          </div>
        )}
      </div>

      <button
        onClick={create}
        disabled={busy || !contractId || (strategyKind === "custom" && !generated)}
        className={cn(btn, "bg-[#1e7a3c] px-5 py-2 hover:bg-[#259a4b]")}
      >
        Create bot
      </button>
    </div>
  );
}
