"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/utils";
import {
  STOP_POINTS,
  maxContracts,
  type ChallengePlan,
  type FuturesSpec,
} from "@/lib/prop-firm";

const usd0 = (n: number): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#1e222d] px-3 py-2 text-sm text-white";
const lbl = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500";
const btn =
  "rounded px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40";

const STEPS = ["Plan", "Account", "Strategy", "Review"] as const;

interface Platform {
  id: string;
  configured: boolean;
  accounts: { id: number; name: string; balance: number }[];
  linkedAccountId?: number;
}

interface Generated {
  name: string;
  description?: string;
  code: string;
  params: Record<string, number>;
}

/**
 * Wizard that converts a ChallengePlan into a configured futures bot:
 * risk rails come from the plan; the user picks the account, strategy, and
 * reviews before the bot is created (and optionally started).
 */
export function PropFirmWizard({
  plan,
  spec,
  onClose,
}: {
  plan: ChallengePlan;
  spec: FuturesSpec;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platform, setPlatform] = useState("topstep");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [resolved, setResolved] = useState<{ platform: string; id: string } | null>(null);

  const [strategyKind, setStrategyKind] = useState<"ema-cross" | "custom">("ema-cross");
  const [timeframe, setTimeframe] = useState("5m");
  const [size, setSize] = useState(() => Math.max(1, maxContracts(spec, plan.dailyLossLimit)));
  const [slPoints, setSlPoints] = useState(String(STOP_POINTS));
  const [tpPoints, setTpPoints] = useState(String(STOP_POINTS * 2));
  const [fastLen, setFastLen] = useState("10");
  const [slowLen, setSlowLen] = useState("200");
  const [aiPrompt, setAiPrompt] = useState("");
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [generated, setGenerated] = useState<Generated | null>(null);

  const [botName, setBotName] = useState(
    () => `${spec.symbol} ${plan.tier.label} Challenge Bot`,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<{ id: string; started: boolean } | null>(null);

  const plat = platforms.find((p) => p.id === platform);
  const maxSize = Math.max(1, maxContracts(spec, plan.dailyLossLimit));

  useEffect(() => {
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
      .catch(() => setErr("Failed to load futures platforms"));
  }, []);

  // Resolve the root → front-month contractId under the selected platform.
  useEffect(() => {
    if (!platform) return;
    let live = true;
    authFetch(
      `/api/futures/quote?platform=${platform}&symbol=${encodeURIComponent(spec.symbol)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (live) setResolved({ platform, id: d.data?.contractId ?? "" });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [platform, spec.symbol]);

  const contractId = resolved?.platform === platform ? resolved.id : "";

  const generate = async () => {
    setBusy(true);
    setErr("");
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
      if (!res.ok) return setErr(d.error ?? "Generation failed");
      if (d.data?.questions) {
        setQuestions(d.data.questions);
        setAnswers(d.data.questions.map(() => ""));
        return;
      }
      const params: Record<string, number> = {};
      for (const p of d.data?.params ?? []) params[p.name] = p.value;
      setGenerated({
        name: d.data.name,
        description: d.data.description,
        code: d.data.code,
        params,
      });
      setQuestions(null);
    } finally {
      setBusy(false);
    }
  };

  const create = async (startNow: boolean) => {
    setBusy(true);
    setErr("");
    try {
      const strategy =
        strategyKind === "ema-cross"
          ? { kind: "ema-cross" as const, fastLen: +fastLen, slowLen: +slowLen }
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
          name: botName,
          platform,
          accountId: accountId ?? undefined,
          contractId,
          contractName: spec.name,
          timeframe,
          size,
          slPoints: +slPoints,
          tpPoints: +tpPoints,
          strategy,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(d.error ?? "Bot creation failed");
      const id = d.data?.bot?.id as string;
      let started = false;
      if (startNow && id) {
        const s = await authFetch(`/api/futures/bots/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        started = s.ok;
      }
      setCreated({ id, started });
    } finally {
      setBusy(false);
    }
  };

  const canNext =
    step === 0 ||
    (step === 1 && accountId != null && contractId !== "") ||
    (step === 2 && (strategyKind === "ema-cross" || generated != null));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#2a2e39] bg-[#131722] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">🤖 Deploy Plan as Bot</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        {/* Step indicator */}
        <div className="mb-4 flex gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                "flex-1 rounded px-1 py-1 text-center text-[10px] font-semibold",
                i === step
                  ? "bg-[#2962ff] text-white"
                  : i < step
                    ? "bg-[#1e7a3c]/60 text-emerald-200"
                    : "bg-neutral-800 text-gray-500",
              )}
            >
              {i + 1}. {s}
            </div>
          ))}
        </div>

        {created ? (
          <div className="rounded border border-emerald-800 bg-emerald-950/40 p-4 text-center">
            <p className="text-lg">✅</p>
            <p className="mt-1 text-sm font-semibold text-emerald-300">
              Bot created{created.started ? " and started" : ""}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Manage it from the dashboard → 🤖 Bots
            </p>
            <button onClick={onClose} className={cn(btn, "mt-3 bg-[#2962ff]")}>
              Done
            </button>
          </div>
        ) : (
          <>
            {/* ── Step 0: plan recap ─────────────────────────── */}
            {step === 0 && (
              <div className="space-y-3 text-xs">
                <p className="text-gray-400">
                  This wizard turns your challenge plan into a trading bot with
                  safety rails taken straight from the calculation:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Info k="Account" v={`${plan.tier.label} · ${usd0(plan.tier.maxDrawdown)} DD`} />
                  <Info k="Daily loss limit" v={usd0(plan.dailyLossLimit)} />
                  <Info k="Daily profit goal" v={usd0(plan.dailyProfit)} />
                  <Info k="Contract" v={`${spec.symbol} (${spec.name})`} />
                  <Info k="Max contracts (80pt stop)" v={String(maxSize)} />
                  <Info k="Recommended target" v={usd0(plan.recommendedDailyTarget)} />
                </div>
                <p className="rounded border border-amber-700/40 bg-amber-950/30 p-2 text-[11px] text-amber-200">
                  ⚠ Bots trade real eval accounts. A runaway bot can breach your
                  daily loss limit and fail the challenge — the SL/TP brackets
                  help, but monitor it.
                </p>
              </div>
            )}

            {/* ── Step 1: account ────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-3">
                {platforms.filter((p) => p.configured).length === 0 ? (
                  <p className="rounded border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-300">
                    No futures account linked — add a TopStep/Apex account in
                    Admin → Trading accounts first.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={lbl}>Platform</label>
                        <select
                          value={platform}
                          onChange={(e) => {
                            setPlatform(e.target.value);
                            const p = platforms.find((x) => x.id === e.target.value);
                            setAccountId(p?.linkedAccountId ?? p?.accounts[0]?.id ?? null);
                          }}
                          className={sel}
                        >
                          {platforms
                            .filter((p) => p.configured)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.id === "topstep" ? "TopStep" : "Apex"}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className={lbl}>Account</label>
                        <select
                          value={accountId ?? ""}
                          onChange={(e) => setAccountId(Number(e.target.value))}
                          className={sel}
                        >
                          {(plat?.accounts ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · ${a.balance.toLocaleString()}
                              {a.id === plat?.linkedAccountId ? " ★" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Contract</label>
                      <input
                        value={`${spec.symbol} → ${contractId || "resolving…"}`}
                        readOnly
                        className={cn(sel, "text-gray-400")}
                      />
                      <p className="mt-1 text-[10px] text-gray-500">
                        Front month resolved automatically from TopStepX
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Step 2: strategy ───────────────────────────── */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {(["ema-cross", "custom"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setStrategyKind(k)}
                      className={cn(
                        "rounded border p-2.5 text-center text-xs transition",
                        strategyKind === k
                          ? "border-[#2962ff] bg-[#2962ff] text-white"
                          : "border-[#2a2e39] bg-[#1e222d] text-gray-300",
                      )}
                    >
                      {k === "ema-cross" ? "EMA Crossover" : "✨ AI Generated"}
                    </button>
                  ))}
                </div>

                {strategyKind === "ema-cross" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-gray-400">
                      Fast EMA
                      <input value={fastLen} onChange={(e) => setFastLen(e.target.value)}
                        type="number" min={1} className={cn(sel, "mt-1")} />
                    </label>
                    <label className="text-[11px] text-gray-400">
                      Slow EMA
                      <input value={slowLen} onChange={(e) => setSlowLen(e.target.value)}
                        type="number" min={2} className={cn(sel, "mt-1")} />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      rows={3}
                      placeholder={`e.g. Long ${spec.symbol} when price crosses above VWAP in the NY session; exit at TP or session close`}
                      className={cn(sel, "resize-y text-xs")}
                    />
                    {questions && (
                      <div className="space-y-1.5 rounded border border-[#2a2e39] p-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">
                          AI needs more detail
                        </p>
                        {questions.map((q, i) => (
                          <label key={i} className="block text-[11px] text-gray-300">
                            {q}
                            <input
                              value={answers[i] ?? ""}
                              onChange={(e) => {
                                const a = [...answers];
                                a[i] = e.target.value;
                                setAnswers(a);
                              }}
                              className={cn(sel, "mt-0.5 text-xs")}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                    {!generated ? (
                      <button
                        onClick={generate}
                        disabled={busy || !aiPrompt.trim()}
                        className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}
                      >
                        {busy ? "Generating…" : questions ? "Generate with answers" : "Generate strategy"}
                      </button>
                    ) : (
                      <div className="rounded border border-emerald-800 bg-emerald-950/30 p-2 text-xs">
                        <p className="font-semibold text-emerald-300">✓ {generated.name}</p>
                        {generated.description && (
                          <p className="mt-0.5 text-[11px] text-gray-400">{generated.description}</p>
                        )}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[10px] text-gray-500">
                            View code
                          </summary>
                          <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/40 p-2 text-[10px] text-gray-300">
                            {generated.code}
                          </pre>
                        </details>
                        <button
                          onClick={() => setGenerated(null)}
                          className="mt-1 text-[10px] text-gray-500 hover:text-gray-300"
                        >
                          ↺ Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-4 gap-2 border-t border-[#2a2e39] pt-3">
                  <label className="text-[11px] text-gray-400">
                    Timeframe
                    <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className={cn(sel, "mt-1")}>
                      <option value="30s">30s</option>
                      <option value="1m">1m</option>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="1h">1h</option>
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-400">
                    Contracts
                    <input type="number" min={1} max={500} value={size}
                      onChange={(e) => setSize(Math.max(1, +e.target.value || 1))}
                      className={cn(sel, "mt-1")} />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    SL pts
                    <input type="number" min={0} value={slPoints}
                      onChange={(e) => setSlPoints(e.target.value)}
                      className={cn(sel, "mt-1")} />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    TP pts
                    <input type="number" min={0} value={tpPoints}
                      onChange={(e) => setTpPoints(e.target.value)}
                      className={cn(sel, "mt-1")} />
                  </label>
                </div>
                {size > maxSize && (
                  <p className="text-[10px] text-amber-400">
                    ⚠ {size} contracts exceeds your plan&apos;s {maxSize}-contract max — an
                    80pt stop risks {usd0(size * spec.pointValue * STOP_POINTS)} vs the{" "}
                    {usd0(plan.dailyLossLimit)} daily limit.
                  </p>
                )}
              </div>
            )}

            {/* ── Step 3: review ─────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-3 text-xs">
                <label className={lbl}>
                  Bot name
                  <input value={botName} onChange={(e) => setBotName(e.target.value)} className={cn(sel, "mt-1")} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Info k="Platform" v={platform === "topstep" ? "TopStep" : "Apex"} />
                  <Info
                    k="Account"
                    v={plat?.accounts.find((a) => a.id === accountId)?.name ?? String(accountId)}
                  />
                  <Info k="Contract" v={contractId || `${spec.symbol} front`} />
                  <Info k="Timeframe" v={timeframe} />
                  <Info k="Size" v={`${size} contract${size === 1 ? "" : "s"}`} />
                  <Info k="Brackets" v={`SL ${slPoints}pt / TP ${tpPoints}pt`} />
                  <Info
                    k="Strategy"
                    v={
                      strategyKind === "ema-cross"
                        ? `EMA cross ${fastLen}/${slowLen}`
                        : `AI: ${generated?.name ?? "—"}`
                    }
                  />
                  <Info k="Daily loss limit" v={usd0(plan.dailyLossLimit)} />
                </div>
                <p className="rounded border border-[#2a2e39] bg-[#1e222d] p-2 text-[11px] text-gray-400">
                  Worst-case per trade: {usd0(size * spec.pointValue * +slPoints)} (
                  {size} × {slPoints}pt × ${spec.pointValue}/pt). Bots run while
                  the server is up — monitor them.
                </p>
              </div>
            )}

            {err && <p className="mt-2 text-xs text-red-400">{err}</p>}

            {/* Nav */}
            <div className="mt-4 flex items-center gap-2">
              {step > 0 && (
                <button onClick={() => setStep(step - 1)} className={cn(btn, "bg-neutral-700")}>
                  ← Back
                </button>
              )}
              <div className="ml-auto flex gap-2">
                {step < STEPS.length - 1 ? (
                  <button
                    onClick={() => setStep(step + 1)}
                    disabled={!canNext || busy}
                    className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}
                  >
                    Next →
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => create(false)}
                      disabled={busy || !botName.trim() || !contractId}
                      className={cn(btn, "bg-neutral-700 hover:bg-neutral-600")}
                    >
                      Create bot
                    </button>
                    <button
                      onClick={() => create(true)}
                      disabled={busy || !botName.trim() || !contractId}
                      className={cn(btn, "bg-[#1e7a3c] hover:bg-[#259a4b]")}
                    >
                      {busy ? "Working…" : "Create & start ▶"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-[#2a2e39] bg-[#1e222d] px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-gray-500">{k}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-white" title={v}>
        {v}
      </p>
    </div>
  );
}
