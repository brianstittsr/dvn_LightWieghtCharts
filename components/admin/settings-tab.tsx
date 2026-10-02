"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@/lib/settings";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1D"] as const;
const SESSION_ROWS = [
  { label: "Asia", start: "asiaStart", end: "asiaEnd" },
  { label: "London", start: "londonStart", end: "londonEnd" },
  { label: "New York", start: "nyStart", end: "nyEnd" },
] as const;

const input =
  "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-2.5 py-1.5 text-sm outline-none focus:border-[#2962ff]";

export default function SettingsTab() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setS(d.data))
      .catch(() => setErr("Failed to load settings"));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(d.error ?? "Save failed");
      setMsg("Saved.");
    } finally {
      setBusy(false);
    }
  };

  if (!s) {
    return <p className="py-10 text-center text-sm text-gray-500">{err || "Loading…"}</p>;
  }

  const num = (v: number) => (Number.isFinite(v) ? v : 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#2a2e39] bg-[#131722] p-4">
        <h2 className="mb-3 text-sm font-semibold text-white">Charting</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">
            Default chart count
            <select
              value={s.defaultChartCount}
              onChange={(e) => setS({ ...s, defaultChartCount: Number(e.target.value) })}
              className={`${input} mt-1`}
            >
              {[1, 2, 4, 6, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Default timeframe
            <select
              value={s.defaultTimeframe}
              onChange={(e) => setS({ ...s, defaultTimeframe: e.target.value })}
              className={`${input} mt-1`}
            >
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Position poll interval (ms)
            <input
              type="number"
              min={3000}
              max={120000}
              step={1000}
              value={s.positionPollMs}
              onChange={(e) => setS({ ...s, positionPollMs: num(+e.target.value) })}
              className={`${input} mt-1`}
            />
          </label>
          <label className="flex items-end gap-2 pb-1 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={s.alertsEnabled}
              onChange={(e) => setS({ ...s, alertsEnabled: e.target.checked })}
              className="h-4 w-4 accent-[#2962ff]"
            />
            Session/proximity alerts enabled
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-[#2a2e39] bg-[#131722] p-4">
        <h2 className="mb-3 text-sm font-semibold text-white">Backtest defaults</h2>
        <div className="grid grid-cols-4 gap-3">
          {(
            [
              ["initialCapital", "Capital $"],
              ["riskPerTrade", "Risk %/trade"],
              ["commission", "Commission $"],
              ["slippagePct", "Slippage %"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="text-xs text-gray-400">
              {label}
              <input
                type="number"
                step="any"
                value={s.backtest[k]}
                onChange={(e) =>
                  setS({ ...s, backtest: { ...s.backtest, [k]: num(+e.target.value) } })
                }
                className={`${input} mt-1`}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#2a2e39] bg-[#131722] p-4">
        <h2 className="mb-1 text-sm font-semibold text-white">Session hours (ET)</h2>
        <p className="mb-3 text-xs text-gray-500">
          Default windows for new session indicators — existing indicator instances
          keep their own params.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {SESSION_ROWS.map(({ label, start, end }) => (
            <div key={label} className="rounded border border-[#1e222d] p-2.5">
              <p className="mb-2 text-xs font-medium text-gray-300">{label}</p>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`${label} start hour`}
                  type="number"
                  min={0}
                  max={23}
                  value={s.sessions[start]}
                  onChange={(e) =>
                    setS({ ...s, sessions: { ...s.sessions, [start]: num(+e.target.value) } })
                  }
                  className={input}
                />
                <span className="text-xs text-gray-500">–</span>
                <input
                  aria-label={`${label} end hour`}
                  type="number"
                  min={0}
                  max={23}
                  value={s.sessions[end]}
                  onChange={(e) =>
                    setS({ ...s, sessions: { ...s.sessions, [end]: num(+e.target.value) } })
                  }
                  className={input}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded bg-[#2962ff] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>
    </div>
  );
}
