"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { getCustomStrategies } from "@/lib/custom-strategies";
import type { AssetClass } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#1e222d] px-2.5 py-1.5 text-sm text-white";
const lbl =
  "mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500";
const btn =
  "rounded px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40";

interface Platform {
  id: string;
  configured: boolean;
  accounts: { id: number; name: string; balance: number }[];
  linkedAccountId?: number;
}

/**
 * Deploy a scanner hit as a bot. Futures → /api/futures/bots (TopStep/Apex,
 * front-month resolved automatically). Stocks & crypto → /api/bots (Alpaca).
 */
export function DeployBotDialog({
  assetClass,
  symbol,
  onClose,
}: {
  assetClass: AssetClass;
  symbol: string;
  onClose: () => void;
}) {
  const futures = assetClass === "future";
  const [name, setName] = useState(`${symbol} scanner bot`);
  const [platform, setPlatform] = useState("topstep");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [contractId, setContractId] = useState("");
  const [timeframe, setTimeframe] = useState("5m");
  const [qty, setQty] = useState("1");
  const [sl, setSl] = useState(futures ? "40" : "2");
  const [tp, setTp] = useState(futures ? "80" : "4");
  const [strategyKind, setStrategyKind] = useState<"ema-cross" | "custom">("ema-cross");
  const [fastLen, setFastLen] = useState("10");
  const [slowLen, setSlowLen] = useState("200");
  const [strategyId, setStrategyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const strategies = getCustomStrategies();
  const plat = platforms.find((p) => p.id === platform);

  useEffect(() => {
    if (!futures) return;
    authFetch("/api/futures/status")
      .then((r) => r.json())
      .then((d) => {
        const list: Platform[] = d.data?.platforms ?? [];
        setPlatforms(list);
        const first = list.find((p) => p.accounts.length > 0);
        if (first) {
          setPlatform(first.id);
          setAccountId(first.linkedAccountId ?? first.accounts[0].id);
        }
      })
      .catch(() => {});
  }, [futures]);

  useEffect(() => {
    if (!futures || !platform) return;
    let live = true;
    authFetch(
      `/api/futures/quote?platform=${platform}&symbol=${encodeURIComponent(symbol)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (live) setContractId(d.data?.contractId ?? "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [futures, platform, symbol]);

  const strategy = () => {
    if (strategyKind === "ema-cross") {
      return { kind: "ema-cross" as const, fastLen: +fastLen, slowLen: +slowLen };
    }
    const custom = strategies.find((s) => s.id === strategyId);
    if (!custom) return null;
    return {
      kind: "custom" as const,
      name: custom.name,
      prompt: "",
      code: custom.code,
      params: Object.fromEntries(custom.params.map((p) => [p.key, Number(p.default)])),
    };
  };

  const deploy = async (startNow: boolean) => {
    const s = strategy();
    if (!s) return setErr("Pick a saved strategy first");
    setBusy(true);
    setErr("");
    try {
      const res = await authFetch(futures ? "/api/futures/bots" : "/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          futures
            ? {
                name,
                platform,
                accountId: accountId ?? undefined,
                contractId,
                contractName: symbol,
                timeframe,
                size: +qty,
                slPoints: +sl,
                tpPoints: +tp,
                strategy: s,
              }
            : {
                name,
                symbol: symbol.toUpperCase(),
                assetClass,
                timeframe: timeframe === "30s" ? "1m" : timeframe,
                qty: +qty,
                slPct: +sl,
                tpPct: +tp,
                strategy: s,
              },
        ),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(d.error ?? "Deploy failed");
      const id = d.data?.bot?.id as string | undefined;
      if (startNow && id) {
        await authFetch(`${futures ? "/api/futures/bots" : "/api/bots"}/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[#2a2e39] bg-[#131722] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">
            🤖 Deploy {symbol} as a bot
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">✕</button>
        </div>

        {done ? (
          <div className="rounded border border-emerald-800 bg-emerald-950/40 p-4 text-center">
            <p className="text-lg">✅</p>
            <p className="mt-1 text-sm font-semibold text-emerald-300">Bot deployed</p>
            <p className="mt-1 text-xs text-gray-400">Manage it from the dashboard → 🤖 Bots</p>
            <button onClick={onClose} className={cn(btn, "mt-3 bg-[#2962ff]")}>Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-[#2a2e39] bg-[#1e222d] px-3 py-2 text-xs text-gray-400">
              Venue:{" "}
              <b className="text-white">
                {futures ? "TopStep/Apex (ProjectX)" : assetClass === "crypto" ? "Alpaca crypto (long-only)" : "Alpaca paper"}
              </b>
              {futures && <span className="ml-2 text-gray-500">{contractId || "resolving contract…"}</span>}
            </div>

            {futures && (
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className={lbl}>Platform</span>
                  <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={sel}>
                    {platforms.filter((p) => p.configured).map((p) => (
                      <option key={p.id} value={p.id}>{p.id === "topstep" ? "TopStep" : "Apex"}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={lbl}>Account</span>
                  <select value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))} className={sel}>
                    {(plat?.accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · ${a.balance.toLocaleString()}
                        {a.id === plat?.linkedAccountId ? " ★" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <label>
              <span className={lbl}>Bot name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={sel} />
            </label>

            <div className="grid grid-cols-4 gap-2">
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
                <span className={lbl}>{futures ? "Contracts" : "Qty"}</span>
                <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={sel} />
              </label>
              <label>
                <span className={lbl}>{futures ? "SL pts" : "SL %"}</span>
                <input type="number" min={0} value={sl} onChange={(e) => setSl(e.target.value)} className={sel} />
              </label>
              <label>
                <span className={lbl}>{futures ? "TP pts" : "TP %"}</span>
                <input type="number" min={0} value={tp} onChange={(e) => setTp(e.target.value)} className={sel} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(["ema-cross", "custom"] as const).map((k) => (
                <button key={k} onClick={() => setStrategyKind(k)}
                  className={cn(
                    "rounded border p-2 text-xs transition",
                    strategyKind === k ? "border-[#2962ff] bg-[#2962ff] text-white" : "border-[#2a2e39] bg-[#1e222d] text-gray-300",
                  )}>
                  {k === "ema-cross" ? "EMA Crossover" : "Saved AI strategy"}
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
                  <option value="">— pick a saved strategy —</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>✨ {s.name}</option>
                  ))}
                </select>
              </label>
            )}

            {err && <p className="text-xs text-red-400">{err}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={() => deploy(false)} disabled={busy || (futures && !contractId)}
                className={cn(btn, "bg-neutral-700 hover:bg-neutral-600")}>
                Create bot
              </button>
              <button onClick={() => deploy(true)} disabled={busy || (futures && !contractId)}
                className={cn(btn, "bg-[#1e7a3c] hover:bg-[#259a4b]")}>
                {busy ? "Deploying…" : "Create & start ▶"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
