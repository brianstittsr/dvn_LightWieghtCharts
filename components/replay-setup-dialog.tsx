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

export interface CopyAccountSetup {
  name: string;
  balance: number;
  multiplier: number;
  challenge: ChallengeConfig | null;
}

export interface ReplaySetupConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startBalance: number;
  challenge: ChallengeConfig | null;
  /** Copy accounts for multi-account scaling. Empty = single-account mode. */
  copyAccounts: CopyAccountSetup[];
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
  const [useCopyTrading, setUseCopyTrading] = useState(false);
  const [copyAccounts, setCopyAccounts] = useState<{ name: string; balance: string; multiplier: string }[]>([]);

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

    const copies: CopyAccountSetup[] = useCopyTrading
      ? copyAccounts.map((c) => ({
          name: c.name || "Copy",
          balance: Number(c.balance) || balance,
          multiplier: Number(c.multiplier) || 1,
          challenge,
        }))
      : [];

    onStart({
      startDate,
      endDate,
      startBalance: balance,
      challenge,
      copyAccounts: copies,
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

        {/* Copy Trading */}
        <div className="mb-3 flex items-center gap-2">
          <input
            type="checkbox"
            id="rsd-copy"
            checked={useCopyTrading}
            onChange={(e) => setUseCopyTrading(e.target.checked)}
            className="accent-purple-600"
          />
          <label htmlFor="rsd-copy" className="text-xs text-neutral-300">
            Copy trading (simulate multiple accounts scaling up)
          </label>
        </div>

        {useCopyTrading && (
          <div className="mb-3 rounded border border-[#2a2e39] bg-[#0d1117] p-2">
            <p className="mb-2 text-[10px] text-neutral-500">
              Add copy accounts that mirror the master. Each account scales the master qty by its multiplier.
            </p>
            {copyAccounts.map((ca, i) => (
              <div key={i} className="mb-1.5 grid grid-cols-[1fr_80px_60px_24px] items-end gap-1">
                <div>
                  {i === 0 && <label className={lbl}>Name</label>}
                  <input
                    value={ca.name}
                    onChange={(e) => {
                      const next = [...copyAccounts];
                      next[i] = { ...next[i], name: e.target.value };
                      setCopyAccounts(next);
                    }}
                    placeholder={`Copy ${i + 1}`}
                    className={sel}
                  />
                </div>
                <div>
                  {i === 0 && <label className={lbl}>Balance</label>}
                  <input
                    type="number"
                    value={ca.balance}
                    onChange={(e) => {
                      const next = [...copyAccounts];
                      next[i] = { ...next[i], balance: e.target.value };
                      setCopyAccounts(next);
                    }}
                    className={sel}
                  />
                </div>
                <div>
                  {i === 0 && <label className={lbl}>Scale</label>}
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={ca.multiplier}
                    onChange={(e) => {
                      const next = [...copyAccounts];
                      next[i] = { ...next[i], multiplier: e.target.value };
                      setCopyAccounts(next);
                    }}
                    className={sel}
                    title="Qty multiplier (1 = same size, 2 = double, 0.5 = half)"
                  />
                </div>
                <button
                  onClick={() => setCopyAccounts(copyAccounts.filter((_, j) => j !== i))}
                  className="self-end rounded bg-red-900/50 px-1 py-1.5 text-[10px] text-red-300 hover:bg-red-800"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() =>
                  setCopyAccounts([...copyAccounts, { name: `Copy ${copyAccounts.length + 1}`, balance: customBalance || "100000", multiplier: "1" }])
                }
                className="rounded bg-purple-800/60 px-2 py-1 text-[10px] font-semibold text-purple-200 hover:bg-purple-700"
              >
                + Add Account
              </button>
              {copyAccounts.length === 0 && (
                <button
                  onClick={() => {
                    const bal = customBalance || "100000";
                    setCopyAccounts([
                      { name: "Account 2", balance: bal, multiplier: "1" },
                      { name: "Account 3", balance: bal, multiplier: "2" },
                      { name: "Account 4", balance: bal, multiplier: "3" },
                    ]);
                  }}
                  className="rounded bg-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:text-white"
                >
                  Quick: 3 accounts (1x, 2x, 3x)
                </button>
              )}
            </div>
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
