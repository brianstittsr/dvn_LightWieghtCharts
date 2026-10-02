"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  BACKTEST_STRATEGIES,
  runBacktest,
  type BacktestConfig,
  type BacktestResult,
} from "@/lib/backtest";
import {
  deleteCustomStrategy,
  getCustomStrategies,
  getServerCustomStrategies,
  saveCustomStrategy,
  subscribeCustomStrategies,
  type CustomStrategySpec,
} from "@/lib/custom-strategies";
import type { Candle } from "@/lib/types";

const inputCls =
  "w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-blue-500";

const CUSTOM_PREFIX = "custom:";

/** Backtest config dialog — runs the engine over the pane's loaded candles. */
export function BacktestDialog({
  open,
  symbol,
  timeframe,
  getCandles,
  onResult,
  onClose,
}: {
  open: boolean;
  symbol: string;
  timeframe: string;
  getCandles: () => Candle[];
  onResult: (r: BacktestResult) => void;
  onClose: () => void;
}) {
  const [strategy, setStrategy] = useState<string>("sma-cross");
  const [capital, setCapital] = useState("10000");
  const [risk, setRisk] = useState("1");
  const [commission, setCommission] = useState("1");
  const [slippage, setSlippage] = useState("0.02");
  const [longShort, setLongShort] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const customs = useSyncExternalStore(
    subscribeCustomStrategies,
    getCustomStrategies,
    getServerCustomStrategies,
  );
  const [paramVals, setParamVals] = useState<Record<string, number>>({});
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<string[] | null>(null);
  const [aiAnswers, setAiAnswers] = useState<string[]>([]);

  // Seed backtest defaults from admin settings each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const b = d?.data?.backtest;
        if (cancelled || !b) return;
        setCapital(String(b.initialCapital));
        setRisk(String(b.riskPerTrade));
        setCommission(String(b.commission));
        setSlippage(String(b.slippagePct));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const isCustom = strategy.startsWith(CUSTOM_PREFIX);
  const customSpec = isCustom
    ? customs.find((s) => `${CUSTOM_PREFIX}${s.id}` === strategy)
    : undefined;
  const stratLabel = isCustom
    ? (customSpec?.name ?? "Custom strategy")
    : (BACKTEST_STRATEGIES.find((s) => s.id === strategy)?.label ?? strategy);
  const stratBlurb = isCustom
    ? (customSpec?.description ?? "AI-generated strategy")
    : (BACKTEST_STRATEGIES.find((s) => s.id === strategy)?.blurb ?? "");

  const generate = async (): Promise<void> => {
    if (aiPrompt.trim().length < 3) return;
    setAiBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          // Phase 2: resubmit with the user's answers to the follow-ups.
          ...(aiQuestions ? { answers: aiAnswers } : {}),
        }),
      });
      const body = (await res.json()) as {
        data?:
          | { questions: string[] }
          | { name: string; description?: string; params: CustomStrategySpec["params"]; code: string };
        error?: string;
      };
      if (!res.ok || !body.data) {
        setError(body.error ?? "AI generation failed");
        return;
      }
      // Model needs clarification first — render its questions.
      if ("questions" in body.data) {
        setAiQuestions(body.data.questions);
        setAiAnswers(new Array<string>(body.data.questions.length).fill(""));
        return;
      }
      const spec: CustomStrategySpec = {
        id: `ai-${Date.now().toString(36)}`,
        name: body.data.name,
        description: body.data.description,
        params: body.data.params,
        code: body.data.code,
      };
      saveCustomStrategy(spec);
      setStrategy(`${CUSTOM_PREFIX}${spec.id}`);
      setAiPrompt("");
      setAiQuestions(null);
      setAiAnswers([]);
    } catch {
      setError("AI generation failed — network error");
    } finally {
      setAiBusy(false);
    }
  };

  const run = (): void => {
    const candles = getCandles();
    if (candles.length < 50) {
      setError(`Need ≥50 loaded candles to backtest (have ${candles.length}) — zoom out or pick a longer timeframe.`);
      return;
    }
    if (isCustom && !customSpec) {
      setError("Selected custom strategy was not found — pick another.");
      return;
    }
    const cfg: BacktestConfig = {
      strategy,
      initialCapital: Math.max(1, Number(capital) || 10000),
      riskPerTrade: Math.min(50, Math.max(0.01, Number(risk) || 1)),
      commission: Math.max(0, Number(commission) || 0),
      slippagePct: Math.max(0, Number(slippage) || 0),
      longShort,
    };
    try {
      const params = customSpec
        ? Object.fromEntries(
            customSpec.params.map((p) => [p.key, paramVals[p.key] ?? Number(p.default)]),
          )
        : undefined;
      const result = runBacktest(
        candles,
        cfg,
        symbol,
        timeframe,
        customSpec ? { code: customSpec.code, params } : undefined,
      );
      setError(null);
      onResult(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg border border-neutral-700 bg-[#16181d] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">
            Backtest — {symbol} {timeframe}
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200" aria-label="Close">
            ×
          </button>
        </div>

        <div className="space-y-2.5">
          <label className="block text-[11px] text-neutral-400">
            Strategy
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className={`${inputCls} mt-1`}
            >
              <optgroup label="Built-in">
                {BACKTEST_STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              {customs.length > 0 && (
                <optgroup label="AI generated">
                  {customs.map((s) => (
                    <option key={s.id} value={`${CUSTOM_PREFIX}${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <span className="mt-0.5 flex items-center justify-between text-[10px] text-neutral-500">
              <span>{stratBlurb}</span>
              {isCustom && customSpec && (
                <button
                  onClick={() => {
                    deleteCustomStrategy(customSpec.id);
                    setStrategy("sma-cross");
                  }}
                  className="ml-2 shrink-0 text-red-400 hover:text-red-300"
                >
                  delete
                </button>
              )}
            </span>
          </label>

          {customSpec && customSpec.params.length > 0 && (
            <div className="grid grid-cols-2 gap-2 rounded border border-neutral-800 p-2">
              {customSpec.params.map((p) => (
                <label key={p.key} className="block text-[11px] text-neutral-400">
                  {p.label}
                  <input
                    type="number"
                    value={paramVals[p.key] ?? Number(p.default)}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    onChange={(e) =>
                      setParamVals((v) => ({ ...v, [p.key]: Number(e.target.value) }))
                    }
                    className={`${inputCls} mt-1`}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-neutral-400">
              Initial capital $
              <input value={capital} onChange={(e) => setCapital(e.target.value)} type="number" min="1" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-[11px] text-neutral-400">
              Risk per trade %
              <input value={risk} onChange={(e) => setRisk(e.target.value)} type="number" min="0.01" step="0.1" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-[11px] text-neutral-400">
              Commission $/side
              <input value={commission} onChange={(e) => setCommission(e.target.value)} type="number" min="0" step="0.5" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-[11px] text-neutral-400">
              Slippage %
              <input value={slippage} onChange={(e) => setSlippage(e.target.value)} type="number" min="0" step="0.01" className={`${inputCls} mt-1`} />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-neutral-300">
            <input
              type="checkbox"
              checked={longShort}
              onChange={(e) => setLongShort(e.target.checked)}
              className="accent-blue-500"
            />
            Allow short trades
          </label>

          <div className="rounded border border-neutral-800 p-2">
            <div className="mb-1 text-[11px] font-medium text-neutral-300">
              Generate strategy with AI
            </div>
            <textarea
              value={aiPrompt}
              onChange={(e) => {
                setAiPrompt(e.target.value);
                setAiQuestions(null);
              }}
              placeholder='e.g. "Go long when price closes above the prior 20-bar high after RSI dips below 40"'
              rows={2}
              disabled={aiQuestions !== null}
              className={`${inputCls} resize-none disabled:opacity-60`}
            />
            {aiQuestions && (
              <div className="mt-2 space-y-1.5">
                <div className="text-[10px] font-medium text-purple-300">
                  To make this runnable, the AI needs a few details:
                </div>
                {aiQuestions.map((q, i) => (
                  <label key={i} className="block text-[10px] text-neutral-400">
                    {i + 1}. {q}
                    <input
                      value={aiAnswers[i] ?? ""}
                      onChange={(e) =>
                        setAiAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))
                      }
                      placeholder="Your answer"
                      className={`${inputCls} mt-0.5`}
                    />
                  </label>
                ))}
                <button
                  onClick={() => {
                    setAiQuestions(null);
                    setAiAnswers([]);
                  }}
                  className="text-[10px] text-neutral-500 underline hover:text-neutral-300"
                >
                  Start over with a new description
                </button>
              </div>
            )}
            <button
              onClick={generate}
              disabled={
                aiBusy ||
                aiPrompt.trim().length < 3 ||
                (aiQuestions !== null && aiAnswers.some((a) => !a.trim()))
              }
              className="mt-1.5 w-full rounded bg-purple-600 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aiBusy ? "Generating…" : aiQuestions ? "Generate with answers" : "Generate strategy"}
            </button>
          </div>

          <p className="text-[10px] leading-snug text-neutral-500">
            Runs over the candles currently loaded in this pane. Entries/exits fill at the next
            bar&apos;s open with slippage; a 2×ATR(14) stop sizes each position from your risk %.
          </p>

          {error && <div className="rounded bg-red-900/30 px-2 py-1.5 text-[11px] text-red-300">{error}</div>}

          <button
            onClick={run}
            className="w-full rounded bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
          >
            Run backtest — {stratLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
