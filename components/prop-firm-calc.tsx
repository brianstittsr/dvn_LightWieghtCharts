"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TIERS,
  FUTURES_CONTRACTS,
  RISK_PCT,
  STOP_POINTS,
  calcChallengePlan,
  maxContracts,
  riskPerContract,
  type AccountTier,
  type ChallengePlan,
  type FuturesSpec,
  type RiskLevel,
} from "@/lib/prop-firm";

const usd = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const usd0 = (n: number): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const card = "rounded-lg border border-[#2a2e39] bg-[#131722] p-4";
const sel =
  "w-full rounded border border-[#2a2e39] bg-[#1e222d] px-3 py-2 text-sm text-white";

export default function PropFirmCalc(): React.ReactElement {
  const [tier, setTier] = useState<AccountTier | null>(null);
  const [spec, setSpec] = useState<FuturesSpec | null>(null);
  const [risk, setRisk] = useState<RiskLevel>("normal");
  const [dailyGoal, setDailyGoal] = useState("250");
  const [plan, setPlan] = useState<ChallengePlan | null>(null);

  const dailyLossLimit = tier ? tier.maxDrawdown * RISK_PCT[risk] : 0;
  const planContracts = useMemo(
    () => (plan && spec ? maxContracts(spec, plan.dailyLossLimit) : 0),
    [plan, spec],
  );

  const calculate = (): void => {
    if (!tier) return;
    setPlan(calcChallengePlan(tier, risk, Number(dailyGoal) || 0));
  };

  return (
    <div className="min-h-screen bg-[#0f1115] text-gray-200">
      <header className="flex items-center gap-3 border-b border-[#2a2e39] bg-[#131722] px-4 py-3">
        <span className="text-xl">🧮</span>
        <div>
          <h1 className="text-sm font-bold text-white">
            Prop Firm Challenge Calculator
          </h1>
          <p className="text-[11px] text-gray-500">
            Plan your path to funded trading with precision
          </p>
        </div>
        <Link
          href="/"
          className="ml-auto rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
        >
          ← Dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        {/* ── Account configuration ─────────────────────────── */}
        <section className={card}>
          <h2 className="text-sm font-semibold text-white">
            Account Configuration
          </h2>
          <p className="mb-3 text-[11px] text-gray-500">
            Select your account size and set your daily profit target
          </p>

          <h3 className="mb-1.5 text-xs font-medium text-gray-300">
            Account Size
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ACCOUNT_TIERS.map((t) => (
              <button
                key={t.size}
                onClick={() => setTier(t)}
                className={cn(
                  "rounded border p-2.5 text-center transition",
                  tier?.size === t.size
                    ? "border-[#2962ff] bg-[#2962ff] text-white"
                    : "border-[#2a2e39] bg-[#1e222d] text-gray-300 hover:border-[#3a3f4b]",
                )}
              >
                <p className="text-sm font-bold">{t.label}</p>
                <p
                  className={cn(
                    "text-[10px]",
                    tier?.size === t.size ? "text-blue-100" : "text-gray-500",
                  )}
                >
                  {usd0(t.maxDrawdown)} DD
                </p>
              </button>
            ))}
          </div>
          {!tier && (
            <p className="mt-1.5 text-[11px] text-gray-500">
              Select an account size to continue
            </p>
          )}

          <h3 className="mb-1.5 mt-4 text-xs font-medium text-gray-300">
            Futures Contract
          </h3>
          <select
            value={spec?.symbol ?? ""}
            onChange={(e) =>
              setSpec(
                FUTURES_CONTRACTS.find((c) => c.symbol === e.target.value) ??
                  null,
              )
            }
            className={sel}
          >
            <option value="">Select a futures contract</option>
            {FUTURES_CONTRACTS.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.symbol} — {c.name} (${c.pointValue}/pt)
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-gray-500">
            Select a contract to calculate position sizing based on{" "}
            {STOP_POINTS}-point risk
          </p>

          <h3 className="mb-1.5 mt-4 text-xs font-medium text-gray-300">
            Daily Risk Level
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {(["normal", "high"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRisk(r)}
                className={cn(
                  "rounded border p-3 text-center transition",
                  risk === r
                    ? "border-[#2962ff] bg-[#2962ff] text-white"
                    : "border-[#2a2e39] bg-[#1e222d] text-gray-300 hover:border-[#3a3f4b]",
                )}
              >
                <p className="text-sm font-semibold capitalize">
                  {r === "high" ? "⚠ High" : "◯ Normal"}
                </p>
                <p
                  className={cn(
                    "text-[10px]",
                    risk === r ? "text-blue-100" : "text-gray-500",
                  )}
                >
                  {Math.round(RISK_PCT[r] * 100)}% of drawdown
                </p>
              </button>
            ))}
          </div>
          {tier && (
            <p className="mt-1.5 text-[11px] text-gray-500">
              Daily loss limit: {usd0(dailyLossLimit)} (
              {Math.round(RISK_PCT[risk] * 100)}% of{" "}
              {usd0(tier.maxDrawdown)} drawdown)
            </p>
          )}

          <h3 className="mb-1.5 mt-4 text-xs font-medium text-gray-300">
            Daily Profit Goal ($)
          </h3>
          <input
            type="number"
            min={1}
            step={10}
            value={dailyGoal}
            onChange={(e) => setDailyGoal(e.target.value)}
            className={sel}
          />
          <p className="mt-1.5 text-[11px] text-gray-500">
            Your target daily profit to achieve consistency
          </p>

          <button
            onClick={calculate}
            disabled={!tier}
            className="mt-4 rounded bg-[#2962ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e53e5] disabled:opacity-40"
          >
            📊 Calculate Plan
          </button>
        </section>

        {plan && (
          <>
            {/* ── Stat cards ─────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                icon="🎯"
                value={String(plan.daysToPass)}
                title="Days to Pass Challenge"
                sub="Trading days to reach profit target"
              />
              <StatCard
                icon="📈"
                value={String(plan.daysToBuffer)}
                title="Days to Buffer Amount"
                sub="Days to build safety buffer"
              />
              <StatCard
                icon="🏆"
                value={String(plan.daysToMaxPayout)}
                title="Days to Max Payout"
                sub="Total days to maximum withdrawal"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* ── Calculation summary ──────────────────────── */}
              <section className={card}>
                <h2 className="text-sm font-semibold text-white">
                  Calculation Summary
                </h2>
                <p className="mb-2 text-[11px] text-gray-500">
                  Detailed breakdown of your account metrics
                </p>
                <table className="w-full text-xs">
                  <tbody>
                    <Metric label="Account Size" value={usd(plan.tier.size)} />
                    <Metric
                      label="Max Drawdown"
                      value={usd(plan.tier.maxDrawdown)}
                    />
                    <Metric
                      label="Profit Goal"
                      value={usd(plan.tier.profitGoal)}
                    />
                    <Metric
                      label="Daily Profit Target"
                      value={usd(plan.dailyProfit)}
                    />
                    <Metric
                      label="Slow Goal Target"
                      value={usd(plan.slowDailyTarget)}
                    />
                    <Metric
                      label="Fast Goal Target"
                      value={usd(plan.fastDailyTarget)}
                    />
                    <Metric
                      label="Buffer Amount"
                      value={usd(plan.bufferBalance)}
                    />
                    <Metric
                      label="Max Payout (per cycle)"
                      value={usd(plan.tier.maxPayout)}
                    />
                    <Metric
                      label="Max DD %"
                      value={`${(plan.maxDrawdownPct * 100).toFixed(2)}%`}
                    />
                  </tbody>
                </table>
              </section>

              {/* ── Timeline breakdown ───────────────────────── */}
              <section className={card}>
                <h2 className="text-sm font-semibold text-white">
                  Timeline Breakdown
                </h2>
                <p className="mb-3 text-[11px] text-gray-500">
                  Visual comparison of milestone timelines
                </p>
                <div className="space-y-1.5">
                  <Bar
                    label=""
                    days={plan.daysToPass}
                    max={plan.daysToMaxPayout}
                    color="#2962ff"
                  />
                  <Bar
                    label=""
                    days={plan.daysToBuffer}
                    max={plan.daysToMaxPayout}
                    color="#16a34a"
                  />
                  <Bar
                    label=""
                    days={plan.daysToMaxPayout}
                    max={plan.daysToMaxPayout}
                    color="#d97706"
                  />
                </div>
                <div className="mt-2 flex gap-4 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1">
                    <i className="inline-block h-2 w-2 rounded-sm bg-[#2962ff]" />
                    Days to Pass
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="inline-block h-2 w-2 rounded-sm bg-[#16a34a]" />
                    Days to Buffer
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="inline-block h-2 w-2 rounded-sm bg-[#d97706]" />
                    Days to Max Payout
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-xs">
                  <PhaseRow
                    label="Challenge Phase"
                    days={plan.daysToPass}
                    cls="bg-[#1e2a4a] text-blue-300"
                  />
                  <PhaseRow
                    label="Buffer Building"
                    days={plan.daysToBuffer}
                    cls="bg-[#14301f] text-emerald-300"
                  />
                  <PhaseRow
                    label="To Maximum Payout"
                    days={plan.daysToMaxPayout}
                    cls="bg-[#3a2c10] text-amber-300"
                  />
                </div>
              </section>
            </div>

            {/* ── Position sizing ────────────────────────────── */}
            {spec && (
              <section className={card}>
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-white">
                  📈 Position Sizing
                </h2>
                {planContracts > 0 ? (
                  <div className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2.5 text-xs">
                    <p className="font-semibold text-emerald-300">
                      ✓ Position Size Approved
                    </p>
                    <p className="text-emerald-200/80">
                      You can safely trade up to {planContracts} {spec.symbol}{" "}
                      contract{planContracts === 1 ? "" : "s"} with an{" "}
                      {STOP_POINTS}-point stop loss while staying within your{" "}
                      {usd0(plan.dailyLossLimit)} daily loss limit.
                    </p>
                  </div>
                ) : (
                  <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2.5 text-xs">
                    <p className="font-semibold text-red-300">
                      ✗ Position Size Rejected
                    </p>
                    <p className="text-red-200/80">
                      One {spec.symbol} contract risks{" "}
                      {usd0(riskPerContract(spec))} at an {STOP_POINTS}-point
                      stop — above your {usd0(plan.dailyLossLimit)} daily loss
                      limit. Trade a micro contract instead.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* ── Contract specifications ────────────────────── */}
            <section className={card}>
              <h2 className="text-sm font-semibold text-white">
                Contract Specifications
              </h2>
              <p className="mb-3 text-[11px] text-gray-500">
                Point and tick values for all available futures contracts
              </p>
              <div className="mb-3 flex items-center justify-between rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-emerald-300">
                    Daily Profit Target
                  </p>
                  <p className="text-[10px] text-emerald-200/70">
                    56% of your {usd0(plan.dailyLossLimit)} daily loss limit
                  </p>
                </div>
                <p className="text-lg font-bold text-emerald-400">
                  {usd0(plan.recommendedDailyTarget)}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#2a2e39] text-left text-[10px] uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-3">Symbol</th>
                      <th className="pr-3">Contract Name</th>
                      <th className="pr-3">Tick Size</th>
                      <th className="pr-3">Tick Value</th>
                      <th className="pr-3">Point Value</th>
                      <th className="pr-3">{STOP_POINTS}pt Risk</th>
                      <th>Max Contracts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FUTURES_CONTRACTS.map((c) => {
                      const selected = spec?.symbol === c.symbol;
                      return (
                        <tr
                          key={c.symbol}
                          onClick={() => setSpec(c)}
                          className={cn(
                            "cursor-pointer border-b border-[#1e222d]",
                            selected
                              ? "bg-[#1e2a4a]"
                              : "hover:bg-[#1e222d]/60",
                          )}
                        >
                          <td className="py-2.5 pr-3 font-bold text-white">
                            {c.symbol}
                            {c.micro && (
                              <span className="ml-1.5 rounded bg-neutral-700 px-1 py-0.5 text-[9px] text-gray-300">
                                Micro
                              </span>
                            )}
                            {selected && (
                              <span className="ml-1.5 rounded bg-[#2962ff] px-1.5 py-0.5 text-[9px] text-white">
                                Selected
                              </span>
                            )}
                          </td>
                          <td className="pr-3 text-gray-400">{c.name}</td>
                          <td className="pr-3">{c.tickSize}</td>
                          <td className="pr-3">{usd(c.tickValue)}</td>
                          <td className="pr-3">${c.pointValue}</td>
                          <td className="pr-3">
                            {usd0(riskPerContract(c))}
                          </td>
                          <td
                            className={cn(
                              maxContracts(c, plan.dailyLossLimit) === 0 &&
                                "text-red-400",
                            )}
                          >
                            {maxContracts(c, plan.dailyLossLimit)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  value,
  title,
  sub,
}: {
  icon: string;
  value: string;
  title: string;
  sub: string;
}): React.ReactElement {
  return (
    <div className={cn(card, "flex items-start gap-3")}>
      <span className="rounded bg-[#1e222d] p-2 text-lg">{icon}</span>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs font-medium text-gray-300">{title}</p>
        <p className="text-[10px] text-gray-500">{sub}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-[#1e222d] last:border-0">
      <td className="py-2.5 text-[10px] uppercase tracking-wide text-gray-500">
        {label}
      </td>
      <td className="py-2.5 text-right font-semibold text-white">{value}</td>
    </tr>
  );
}

function Bar({
  days,
  max,
  color,
}: {
  label: string;
  days: number;
  max: number;
  color: string;
}) {
  return (
    <div className="h-8 w-full rounded bg-[#1e222d]/50">
      <div
        className="flex h-8 items-center rounded px-2 text-[10px] font-bold text-white"
        style={{
          width: `${Math.max(4, (days / Math.max(1, max)) * 100)}%`,
          background: color,
        }}
      />
    </div>
  );
}

function PhaseRow({
  label,
  days,
  cls,
}: {
  label: string;
  days: number;
  cls: string;
}) {
  return (
    <div className={cn("flex items-center justify-between rounded px-3 py-2", cls)}>
      <span>{label}</span>
      <span className="font-bold">{days} days</span>
    </div>
  );
}
