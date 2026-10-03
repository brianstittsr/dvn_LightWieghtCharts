"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { DeployBotDialog } from "@/components/deploy-bot-dialog";
import { getCustomStrategies } from "@/lib/custom-strategies";
import {
  DEFAULT_GAP_FILTERS,
  type AssetClass,
  type GapperResult,
  type ScanRun,
  type ScannerConfig,
  type SetupResult,
  type Watchlist,
} from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#1e222d] px-3 py-1.5 text-sm text-white";
const btn =
  "rounded px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40";
const card = "rounded-lg border border-[#2a2e39] bg-[#1e222d] p-4";
const lbl =
  "mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500";

type Tab = "gappers" | "setup" | "schedules";

function etNowMinutes(): { clock: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = get("hour") === "24" ? "00" : get("hour");
  return {
    clock: `${h}:${get("minute")}`,
    weekday: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
      get("weekday")
    ] ?? 0,
  };
}

const etMinutes = (clock: string): number => {
  const [h, m] = clock.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const etClockStr = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

export function ScannerPage() {
  const [tab, setTab] = useState<Tab>("gappers");
  const [err, setErr] = useState("");
  const et = etNowMinutes();

  return (
    <div className="min-h-screen bg-[#131722] text-white">
      <header className="flex items-center gap-3 border-b border-[#2a2e39] px-4 py-3">
        <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">
          ← Dashboard
        </Link>
        <h1 className="text-sm font-bold">📡 Scanners</h1>
        <span className="ml-auto rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-gray-400">
          {et.clock} ET{et.weekday === 0 || et.weekday === 6 ? " · weekend" : ""}
        </span>
      </header>

      <div className="mx-auto max-w-4xl p-4">
        <div className="mb-4 flex gap-1">
          {(
            [
              ["gappers", "Premarket Gappers"],
              ["setup", "Setup Scanner"],
              ["schedules", "Schedules & Alerts"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                tab === id
                  ? "bg-[#2962ff] text-white"
                  : "bg-neutral-800 text-gray-400 hover:bg-neutral-700",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {err && (
          <p className="mb-3 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {err}
          </p>
        )}

        {tab === "gappers" && <GappersTab onError={setErr} />}
        {tab === "setup" && <SetupTab onError={setErr} />}
        {tab === "schedules" && <SchedulesTab onError={setErr} />}
      </div>
    </div>
  );
}

/* ─── Tab 1: Premarket gappers ──────────────────────────────────────────── */

const ASSET_LABELS: Record<AssetClass, string> = {
  stock: "📈 Stocks",
  crypto: "₿ Crypto",
  future: "⚡ Futures",
};

const VOL_LABEL: Record<AssetClass, string> = {
  stock: "Min PM volume",
  crypto: "Min 24h vol $",
  future: "Min overnight vol",
};

function AssetChips({
  value,
  onChange,
}: {
  value: AssetClass;
  onChange: (a: AssetClass) => void;
}) {
  return (
    <div className="flex gap-1">
      {(Object.keys(ASSET_LABELS) as AssetClass[]).map((a) => (
        <button
          key={a}
          onClick={() => onChange(a)}
          className={cn(
            "rounded px-2.5 py-1 text-[11px] font-semibold transition-colors",
            value === a
              ? "bg-[#2962ff] text-white"
              : "bg-neutral-800 text-gray-400 hover:bg-neutral-700",
          )}
        >
          {ASSET_LABELS[a]}
        </button>
      ))}
    </div>
  );
}

/** Watchlist picker + "save current universe" — shared by both scan tabs. */
function WatchlistPicker({
  assetClass,
  onPick,
  universe,
}: {
  assetClass: AssetClass;
  onPick: (symbols: string[], id: string | undefined) => void;
  universe: string;
}) {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [picked, setPicked] = useState("");

  useEffect(() => {
    authFetch("/api/watchlists")
      .then((r) => r.json())
      .then((d) => setLists(d.data?.watchlists ?? []))
      .catch(() => {});
  }, []);

  const mine = lists.filter((w) => w.assetClass === assetClass);

  const save = async () => {
    const name = window.prompt("Watchlist name:", `My ${assetClass} list`);
    const symbols = universe.split(/[\s,]+/).filter(Boolean);
    if (!name || symbols.length === 0) return;
    const res = await authFetch("/api/watchlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, assetClass, symbols }),
    });
    if (res.ok) {
      const d = await res.json();
      setLists((l) => [...l, d.data.watchlist]);
    }
  };

  return (
    <div className="flex items-end gap-1">
      <Field label="Watchlist">
        <select
          value={picked}
          onChange={(e) => {
            setPicked(e.target.value);
            const wl = mine.find((w) => w.id === e.target.value);
            onPick(wl?.symbols ?? [], e.target.value || undefined);
          }}
          className={cn(sel, "w-36")}
        >
          <option value="">— default universe —</option>
          {mine.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.symbols.length})</option>
          ))}
        </select>
      </Field>
      <button onClick={save} title="Save current universe as a watchlist"
        className={cn(btn, "bg-neutral-700 hover:bg-neutral-600 !py-1.5")}>
        ★ Save
      </button>
    </div>
  );
}

function GappersTab({ onError }: { onError: (e: string) => void }) {
  const [assetClass, setAssetClass] = useState<AssetClass>("stock");
  const [universe, setUniverse] = useState("");
  const [watchlistId, setWatchlistId] = useState<string | undefined>();
  const [filters, setFilters] = useState(DEFAULT_GAP_FILTERS);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ScanRun | null>(null);
  const [history, setHistory] = useState<ScanRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    authFetch("/api/scanner/gappers")
      .then((r) => r.json())
      .then((d) => setHistory(d.data?.runs ?? []))
      .catch(() => {});
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const scan = async () => {
    setBusy(true);
    onError("");
    try {
      const res = await authFetch("/api/scanner/gappers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetClass,
          ...filters,
          universe: universe.split(/[\s,]+/).filter(Boolean),
          watchlistId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return onError(d.error ?? "Scan failed");
      setRun(d.data);
      loadHistory();
    } finally {
      setBusy(false);
    }
  };

  const gappers = run?.gappers ?? history[0]?.gappers ?? [];
  const ranAt = run?.ranAt ?? history[0]?.ranAt;

  return (
    <div className="space-y-4">
      <AssetChips value={assetClass} onChange={(a) => { setAssetClass(a); setWatchlistId(undefined); }} />
      <div className={cn(card, "flex flex-wrap items-end gap-3")}>
        <Field label="Min gap %">
          <input type="number" min={0} value={filters.minGapPct} className={cn(sel, "w-20")}
            onChange={(e) => setFilters({ ...filters, minGapPct: +e.target.value })} />
        </Field>
        <Field label="Min price $">
          <input type="number" min={0} value={filters.minPrice} className={cn(sel, "w-20")}
            onChange={(e) => setFilters({ ...filters, minPrice: +e.target.value })} />
        </Field>
        <Field label={VOL_LABEL[assetClass]}>
          <input type="number" min={0} step={10000} value={filters.minPremarketVolume} className={cn(sel, "w-28")}
            onChange={(e) => setFilters({ ...filters, minPremarketVolume: +e.target.value })} />
        </Field>
        <Field label="Top N">
          <input type="number" min={1} max={30} value={filters.topN} className={cn(sel, "w-16")}
            onChange={(e) => setFilters({ ...filters, topN: +e.target.value })} />
        </Field>
        <WatchlistPicker assetClass={assetClass} universe={universe}
          onPick={(symbols, id) => { setUniverse(symbols.join(",")); setWatchlistId(id); }} />
        <Field label="Or symbols">
          <input value={universe} onChange={(e) => { setUniverse(e.target.value); setWatchlistId(undefined); }}
            placeholder="all" className={cn(sel, "w-32")} />
        </Field>
        <button onClick={scan} disabled={busy}
          className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}>
          {busy ? "Scanning…" : "▶ Run scan"}
        </button>
        {ranAt && (
          <span className="ml-auto text-[10px] text-gray-500">
            Last run {new Date(ranAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {gappers.length === 0 ? (
        <p className="rounded border border-[#2a2e39] bg-[#1e222d] p-6 text-center text-xs text-gray-500">
          {history.length === 0 && !run
            ? "No scans yet — run one to see the biggest premarket movers with their news catalysts."
            : "No gappers passed the filters this run."}
        </p>
      ) : (
        <div className={cn(card, "overflow-hidden !p-0")}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2a2e39] text-left text-[10px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Gap %</th>
                <th className="px-3 py-2 text-right">PM Volume</th>
                <th className="px-3 py-2">Catalyst</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {gappers.map((g: GapperResult) => (
                <GapperRow key={g.symbol} g={g}
                  expanded={expanded === g.symbol}
                  onToggle={() => setExpanded(expanded === g.symbol ? null : g.symbol)}
                  onDeploy={() => setDeploy(g.symbol)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 1 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500">
            Recent runs ({history.length})
          </summary>
          <ul className="mt-1 space-y-1 text-gray-400">
            {history.slice(1).map((r) => (
              <li key={r.id}>
                {new Date(r.ranAt).toLocaleString()} —{" "}
                {r.error ? `error: ${r.error}` : `${r.gappers?.length ?? 0} gappers`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {deploy && (
        <DeployBotDialog
          assetClass={assetClass}
          symbol={deploy}
          onClose={() => setDeploy(null)}
        />
      )}
    </div>
  );
}

function GapperRow({
  g,
  expanded,
  onToggle,
  onDeploy,
}: {
  g: GapperResult;
  expanded: boolean;
  onToggle: () => void;
  onDeploy: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-[#2a2e39]/60 hover:bg-[#262b3a]"
      >
        <td className="px-3 py-2 text-gray-500">{g.rank}</td>
        <td className="px-3 py-2 font-bold text-[#2962ff]">{g.symbol}</td>
        <td className="px-3 py-2 text-right">${g.price.toFixed(2)}</td>
        <td className="px-3 py-2 text-right font-semibold text-emerald-400">
          +{g.gapPct.toFixed(1)}%
        </td>
        <td className="px-3 py-2 text-right text-gray-400">
          {g.premarketVolume.toLocaleString()}
        </td>
        <td className="max-w-[220px] truncate px-3 py-2 text-gray-300" title={g.catalyst ?? ""}>
          {g.catalyst ?? "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <Link
            href={`/?symbol=${g.symbol}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded bg-neutral-700 px-2 py-0.5 text-[10px] text-gray-200 hover:bg-neutral-600"
          >
            Chart ↗
          </Link>{" "}
          <button
            onClick={(e) => { e.stopPropagation(); onDeploy(); }}
            title="Deploy as a trading bot"
            className="rounded bg-[#1e7a3c] px-2 py-0.5 text-[10px] text-white hover:bg-[#259a4b]"
          >
            🤖 Bot
          </button>
        </td>
      </tr>
      {expanded && g.headlines.length > 0 && (
        <tr className="border-b border-[#2a2e39]/60 bg-[#191e2a]">
          <td colSpan={7} className="px-3 py-2">
            <ul className="list-inside list-disc space-y-0.5 text-[11px] text-gray-400">
              {g.headlines.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Tab 2: Setup scanner ──────────────────────────────────────────────── */

function SetupTab({ onError }: { onError: (e: string) => void }) {
  const [assetClass, setAssetClass] = useState<AssetClass>("stock");
  const [universe, setUniverse] = useState("AMD,NVDA,MU");
  const [watchlistId, setWatchlistId] = useState<string | undefined>();
  const [strategyId, setStrategyId] = useState("trend-join-long");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ScanRun | null>(null);
  const [saved, setSaved] = useState(false);
  const [deploy, setDeploy] = useState<string | null>(null);

  const strategies = getCustomStrategies();
  // TJL is stocks-only — fall back to the first saved strategy otherwise.
  const effectiveStrategyId =
    assetClass === "stock"
      ? strategyId
      : strategyId === "trend-join-long"
        ? strategies[0]?.id ?? "trend-join-long"
        : strategyId;

  const scan = async () => {
    setBusy(true);
    onError("");
    const custom = strategies.find((s) => s.id === effectiveStrategyId);
    try {
      const res = await authFetch("/api/scanner/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetClass,
          universe: universe.split(/[\s,]+/).filter(Boolean),
          watchlistId,
          strategyId: custom ? custom.id : "trend-join-long",
          strategyCode: custom?.code,
          strategyParams: custom
            ? Object.fromEntries(custom.params.map((p) => [p.key, Number(p.default)]))
            : undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return onError(d.error ?? "Scan failed");
      setRun(d.data);
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    const custom = strategies.find((s) => s.id === effectiveStrategyId);
    const res = await authFetch("/api/scanner/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "setup",
        name: `Setup · ${custom?.name ?? "Trend Join Long"}`,
        assetClass,
        universe: universe.split(/[\s,]+/).filter(Boolean),
        strategyId: custom?.id ?? "trend-join-long",
        strategyCode: custom?.code,
        strategyParams: custom
          ? Object.fromEntries(custom.params.map((p) => [p.key, Number(p.default)]))
          : undefined,
      }),
    });
    setSaved(res.ok);
    if (!res.ok) onError("Failed to save config");
  };

  return (
    <div className="space-y-4">
      <AssetChips value={assetClass} onChange={(a) => { setAssetClass(a); setWatchlistId(undefined); }} />
      <div className={cn(card, "space-y-3")}>
        <div className="flex flex-wrap items-end gap-3">
          <WatchlistPicker assetClass={assetClass} universe={universe}
            onPick={(symbols, id) => { setUniverse(symbols.join(",")); setWatchlistId(id); }} />
          <Field label="Universe (comma-separated)">
            <input value={universe}
              onChange={(e) => { setUniverse(e.target.value); setWatchlistId(undefined); }}
              placeholder="AMD,NVDA,MU" className={cn(sel, "w-48")} />
          </Field>
          <Field label="Setup / strategy">
            <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={cn(sel, "w-48")}>
              {assetClass === "stock" && (
                <option value="trend-join-long">Trend Join Long (article)</option>
              )}
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  ✨ {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-[10px] text-gray-500">
          TJL: price &gt; prev daily high + prev close &gt; SMA200 (daily breakout)
          and price &gt; PMH + today&apos;s HOD (intraday breakout). Runs between
          10:00–15:30 ET are most meaningful.
        </p>
        <div className="flex gap-2">
          <button onClick={scan} disabled={busy}
            className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}>
            {busy ? "Scanning…" : "▶ Run scan"}
          </button>
          <button onClick={saveConfig} disabled={busy}
            className={cn(btn, "bg-neutral-700 hover:bg-neutral-600")}>
            {saved ? "✓ Saved" : "Save as scheduled config"}
          </button>
        </div>
      </div>

      {run && (
        <div className={cn(card, "!p-0 overflow-hidden")}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2a2e39] text-left text-[10px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">PMH</th>
                <th className="px-3 py-2 text-right">Prev High</th>
                <th className="px-3 py-2 text-right">SMA200</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(run.setups ?? []).map((s: SetupResult) => (
                <tr key={s.symbol} className="border-b border-[#2a2e39]/60">
                  <td className="px-3 py-2 font-bold text-[#2962ff]">{s.symbol}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        s.result === "PASS"
                          ? "bg-emerald-900/60 text-emerald-300"
                          : s.result === "error"
                            ? "bg-red-900/60 text-red-300"
                            : "bg-neutral-800 text-gray-400",
                      )}
                      title={s.reason ?? ""}
                    >
                      {s.result}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {s.currPrice ? `$${s.currPrice.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {s.pmh?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {s.prevDailyHigh?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">
                    {s.sma200?.toFixed(2) ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Link href={`/?symbol=${s.symbol}`}
                      className="rounded bg-neutral-700 px-2 py-0.5 text-[10px] text-gray-200 hover:bg-neutral-600">
                      Chart ↗
                    </Link>{" "}
                    {s.result === "PASS" && (
                      <button
                        onClick={() => setDeploy(s.symbol)}
                        title="Deploy as a trading bot"
                        className="rounded bg-[#1e7a3c] px-2 py-0.5 text-[10px] text-white hover:bg-[#259a4b]"
                      >
                        🤖 Bot
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deploy && (
        <DeployBotDialog
          assetClass={assetClass}
          symbol={deploy}
          onClose={() => setDeploy(null)}
        />
      )}
    </div>
  );
}

/* ─── Tab 3: Schedules & Telegram ───────────────────────────────────────── */

interface UserSettingsView {
  telegramBotTokenMasked?: string;
  telegramChatId?: string;
  hasTelegram: boolean;
  envFallback: boolean;
}

function SchedulesTab({ onError }: { onError: (e: string) => void }) {
  const [configs, setConfigs] = useState<ScannerConfig[]>([]);
  const [settings, setSettings] = useState<UserSettingsView | null>(null);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    authFetch("/api/scanner/configs")
      .then((r) => r.json())
      .then((d) => setConfigs(d.data?.configs ?? []))
      .catch(() => {});
    authFetch("/api/user-settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.data))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    await authFetch(`/api/scanner/configs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  };

  const del = async (id: string) => {
    await authFetch(`/api/scanner/configs/${id}`, { method: "DELETE" });
    load();
  };

  const addGappersConfig = async () => {
    const res = await authFetch("/api/scanner/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "gappers", name: "Premarket Gappers" }),
    });
    if (!res.ok) onError("Failed to create config");
    load();
  };

  const saveTelegram = async () => {
    setBusy(true);
    onError("");
    try {
      const res = await authFetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramBotToken: token || undefined,
          telegramChatId: chatId || undefined,
        }),
      });
      if (!res.ok) return onError("Failed to save Telegram settings");
      setToken("");
      setChatId("");
      load();
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setTestMsg("");
    try {
      const res = await authFetch("/api/notify/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setTestMsg(res.ok ? "✅ Sent — check your phone" : `✗ ${d.error ?? "failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Telegram */}
      <section className={card}>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
          📱 Telegram alerts
        </h3>
        <p className="mb-3 text-[11px] text-gray-500">
          Message <b>@BotFather</b> → <code>/newbot</code> for a token; send
          your bot <code>/start</code>, then read your chat ID from{" "}
          <code>api.telegram.org/bot&lt;token&gt;/getUpdates</code>. Stored
          server-side, masked after save.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`Bot token${settings?.telegramBotTokenMasked ? ` (saved ${settings.telegramBotTokenMasked})` : ""}`}>
            <input value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:ABCdef…" type="password" className={sel} />
          </Field>
          <Field label={`Chat ID${settings?.telegramChatId ? ` (saved ${settings.telegramChatId})` : ""}`}>
            <input value={chatId} onChange={(e) => setChatId(e.target.value)}
              placeholder="123456789" className={sel} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={saveTelegram} disabled={busy || (!token && !chatId)}
            className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}>
            Save
          </button>
          <button onClick={sendTest} disabled={busy || !(settings?.hasTelegram || settings?.envFallback)}
            className={cn(btn, "bg-neutral-700 hover:bg-neutral-600")}>
            Send test
          </button>
          <span className="text-[11px] text-gray-400">{testMsg}</span>
          {!settings?.hasTelegram && settings?.envFallback && (
            <span className="text-[10px] text-amber-400">using env fallback creds</span>
          )}
        </div>
      </section>

      {/* Configs */}
      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">
            ⏱ Scheduled scanners
          </h3>
          <button onClick={addGappersConfig}
            className={cn(btn, "bg-neutral-700 hover:bg-neutral-600")}>
            + Gappers config
          </button>
        </div>
        {configs.length === 0 ? (
          <p className="text-xs text-gray-500">
            No scheduled scanners yet — create one here or &quot;Save as scheduled
            config&quot; from the Setup tab.
          </p>
        ) : (
          <div className="space-y-3">
            {configs.map((c) => (
              <ConfigCard key={c.id} cfg={c} onPatch={patch} onDelete={del} />
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-gray-500">
          Alerts are gated: first run of the day, a changed hit list, or errors
          only — no repeat pings. Scheduled runs need a long-lived server (local
          dev / VPS); on Vercel the daily cron hits <code>/api/scanner/tick</code> —
          intraday intervals require a running server process.
        </p>
      </section>
    </div>
  );
}

function ConfigCard({
  cfg,
  onPatch,
  onDelete,
}: {
  cfg: ScannerConfig;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [start, setStart] = useState(etClockStr(cfg.schedule.windowStartEt));
  const [end, setEnd] = useState(etClockStr(cfg.schedule.windowEndEt));
  const [interval, setIntervalMin] = useState(String(cfg.schedule.intervalMin));

  return (
    <div className="rounded border border-[#2a2e39] bg-[#191e2a] p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() =>
            onPatch(cfg.id, {
              schedule: { ...cfg.schedule, enabled: !cfg.schedule.enabled },
            })
          }
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            cfg.schedule.enabled ? "bg-emerald-600" : "bg-neutral-600",
          )}
          aria-label="toggle schedule"
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
              cfg.schedule.enabled ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>
        <span className="text-xs font-semibold">{cfg.name}</span>
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase text-gray-500">
          {cfg.kind}
        </span>
        <button onClick={() => onDelete(cfg.id)}
          className="ml-auto text-[10px] text-red-400 hover:text-red-300">
          Delete
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2 text-[11px]">
        <Field label="Window start ET">
          <input value={start} onChange={(e) => setStart(e.target.value)}
            placeholder="08:30" className={cn(sel, "w-20 !py-1 text-xs")} />
        </Field>
        <Field label="Window end ET">
          <input value={end} onChange={(e) => setEnd(e.target.value)}
            placeholder="09:30" className={cn(sel, "w-20 !py-1 text-xs")} />
        </Field>
        <Field label="Every (min)">
          <input type="number" min={1} value={interval}
            onChange={(e) => setIntervalMin(e.target.value)}
            className={cn(sel, "w-16 !py-1 text-xs")} />
        </Field>
        <button
          onClick={() =>
            onPatch(cfg.id, {
              schedule: {
                ...cfg.schedule,
                windowStartEt: etMinutes(start),
                windowEndEt: etMinutes(end),
                intervalMin: Math.max(1, +interval || 30),
              },
            })
          }
          className={cn(btn, "bg-neutral-700 hover:bg-neutral-600 !py-1")}
        >
          Save
        </button>
        {cfg.universe && (
          <span className="ml-auto max-w-[240px] truncate text-[10px] text-gray-500" title={cfg.universe.join(", ")}>
            {cfg.universe.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={lbl}>{label}</span>
      {children}
    </label>
  );
}
