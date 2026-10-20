"use client";

import { useState } from "react";
import {
  CHALLENGE_PRESETS,
  type ChallengeConfig,
} from "@/lib/sim-account";

interface ReplaySetupDialogProps {
  open: boolean;
  symbol: string;
  onClose: () => void;
  onStart: (config: ReplaySetupConfig) => void;
}

export interface ReplaySetupConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startBalance: number;
  challenge: ChallengeConfig | null;
}

const presetKeys = Object.keys(CHALLENGE_PRESETS);

export function ReplaySetupDialog({
  open,
  symbol,
  onClose,
  onStart,
}: ReplaySetupDialogProps) {
  // Default: start 3 months ago
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const defaultStart = threeMonthsAgo.toISOString().split("T")[0];
  const defaultEnd = now.toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [selectedPreset, setSelectedPreset] = useState("ftmo-100k");
  const [customBalance, setCustomBalance] = useState("100000");
  const [customTarget, setCustomTarget] = useState("10000");
  const [customMaxLoss, setCustomMaxLoss] = useState("10000");
  const [customDailyLoss, setCustomDailyLoss] = useState("5000");
  const [customMinDays, setCustomMinDays] = useState("4");
  const [useChallenge, setUseChallenge] = useState(true);

  if (!open) return null;

  const preset = CHALLENGE_PRESETS[selectedPreset];
  const isCustom = selectedPreset === "custom";

  const handleStart = () => {
    let challenge: ChallengeConfig | null = null;
    if (useChallenge) {
      if (isCustom) {
        challenge = {
          name: "Custom Challenge",
          startBalance: Number(customBalance) || 100_000,
          profitTarget: Number(customTarget) || 10_000,
          maxLoss: Number(customMaxLoss) || 10_000,
          maxDailyLoss: Number(customDailyLoss) || 5_000,
          minTradingDays: Number(customMinDays) || 0,
        };
      } else {
        challenge = preset;
      }
    }
    const balance = useChallenge
      ? (challenge?.startBalance ?? 100_000)
      : Number(customBalance) || 100_000;

    onStart({
      startDate,
      endDate,
      startBalance: balance,
      challenge,
    });
  };

  const sel = "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-blue-600";
  const lbl = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-neutral-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#2a2e39] bg-[#131722] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Replay Practice Setup</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <p className="mb-4 text-xs text-neutral-400">
          Download historical data for <strong className="text-white">{symbol}</strong> and practice
          trading with a simulated account. Track your P&L calendar to pass FTMO/TopStep challenges.
        </p>

        {/* Date range */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className={lbl} htmlFor="rsd-start">Start Date</label>
            <input
              id="rsd-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={sel}
            />
          </div>
          <div>
            <label className={lbl} htmlFor="rsd-end">End Date</label>
            <input
              id="rsd-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={sel}
            />
          </div>
        </div>

        {/* Challenge toggle */}
        <div className="mb-3 flex items-center gap-2">
          <input
            type="checkbox"
            id="rsd-challenge"
            checked={useChallenge}
            onChange={(e) => setUseChallenge(e.target.checked)}
            className="accent-blue-600"
          />
          <label htmlFor="rsd-challenge" className="text-xs text-neutral-300">
            Challenge mode (track consistency rules)
          </label>
        </div>

        {useChallenge && (
          <>
            {/* Preset selector */}
            <div className="mb-3">
              <label className={lbl}>Challenge Preset</label>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className={sel}
              >
                {presetKeys.map((k) => (
                  <option key={k} value={k}>
                    {CHALLENGE_PRESETS[k].name}
                  </option>
                ))}
              </select>
            </div>

            {/* Preset details or custom fields */}
            {isCustom ? (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Starting Balance</label>
                  <input
                    type="number"
                    value={customBalance}
                    onChange={(e) => setCustomBalance(e.target.value)}
                    className={sel}
                  />
                </div>
                <div>
                  <label className={lbl}>Profit Target</label>
                  <input
                    type="number"
                    value={customTarget}
                    onChange={(e) => setCustomTarget(e.target.value)}
                    className={sel}
                  />
                </div>
                <div>
                  <label className={lbl}>Max Loss</label>
                  <input
                    type="number"
                    value={customMaxLoss}
                    onChange={(e) => setCustomMaxLoss(e.target.value)}
                    className={sel}
                  />
                </div>
                <div>
                  <label className={lbl}>Max Daily Loss</label>
                  <input
                    type="number"
                    value={customDailyLoss}
                    onChange={(e) => setCustomDailyLoss(e.target.value)}
                    className={sel}
                  />
                </div>
                <div>
                  <label className={lbl}>Min Trading Days</label>
                  <input
                    type="number"
                    value={customMinDays}
                    onChange={(e) => setCustomMinDays(e.target.value)}
                    className={sel}
                  />
                </div>
              </div>
            ) : (
              <div className="mb-3 rounded border border-[#2a2e39] bg-[#0d1117] p-2 text-[10px]">
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span className="text-neutral-500">Starting Balance</span>
                  <span className="font-mono text-neutral-200">${preset.startBalance.toLocaleString()}</span>
                  <span className="text-neutral-500">Profit Target</span>
                  <span className="font-mono text-green-400">${preset.profitTarget.toLocaleString()}</span>
                  <span className="text-neutral-500">Max Loss (trailing)</span>
                  <span className="font-mono text-red-400">${preset.maxLoss.toLocaleString()}</span>
                  <span className="text-neutral-500">Max Daily Loss</span>
                  <span className="font-mono text-red-400">${preset.maxDailyLoss.toLocaleString()}</span>
                  <span className="text-neutral-500">Min Trading Days</span>
                  <span className="font-mono text-neutral-200">{preset.minTradingDays}</span>
                  {preset.consistencyPct != null && (
                    <>
                      <span className="text-neutral-500">Consistency Rule</span>
                      <span className="font-mono text-amber-400">No day &gt; {preset.consistencyPct}% of profit</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {!useChallenge && (
          <div className="mb-3">
            <label className={lbl}>Starting Balance ($)</label>
            <input
              type="number"
              value={customBalance}
              onChange={(e) => setCustomBalance(e.target.value)}
              className={sel}
            />
          </div>
        )}

        {/* Start */}
        <button
          onClick={handleStart}
          className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white hover:bg-blue-600"
        >
          Start Replay Practice
        </button>
        <p className="mt-2 text-center text-[10px] text-neutral-600">
          Historical data will be downloaded via the bars API. Large date ranges may take a moment.
        </p>
      </div>
    </div>
  );
}
