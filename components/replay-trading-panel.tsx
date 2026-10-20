"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  SimAccountState,
  SimPosition,
  ChallengeMetrics,
  CopyTradeGroup,
} from "@/lib/sim-account";
import { allCopyAccounts, copyGroupTotalPnl, simChallengeMetrics, calcRiskQty } from "@/lib/sim-account";

interface ReplayTradingPanelProps {
  simAccount: SimAccountState | null;
  currentPrice: number | null;
  symbol: string;
  assetClass: "stock" | "future" | "forex";
  onGoLong: (qty: number, tp?: number, sl?: number) => void;
  onGoShort: (qty: number, tp?: number, sl?: number) => void;
  onPartialClose: (qty: number) => void;
  onFlatten: () => void;
  challengeMetrics: ChallengeMetrics | null;
  copyGroup: CopyTradeGroup | null;
  onOpenAnalytics?: () => void;
}

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/** Floating panel shown during replay for sim trading. */
export function ReplayTradingPanel({
  simAccount,
  currentPrice,
  symbol,
  assetClass,
  onGoLong,
  onGoShort,
  onPartialClose,
  onFlatten,
  challengeMetrics,
  copyGroup,
  onOpenAnalytics,
}: ReplayTradingPanelProps) {
  const [qty, setQty] = useState(1);
  const [partialQty, setPartialQty] = useState(1);
  const [expanded, setExpanded] = useState(true);

  // Bracket order state
  const [useBracket, setUseBracket] = useState(false);
  const [tpDistance, setTpDistance] = useState("");
  const [slDistance, setSlDistance] = useState("");

  // Risk-based sizing state
  const [useRiskSizing, setUseRiskSizing] = useState(false);
  const [riskPct, setRiskPct] = useState("1");
  const [maxQty, setMaxQty] = useState("");

  const position: SimPosition | null =
    simAccount?.positions.find((p) => p.symbol === symbol) ?? null;

  // Compute unrealized P&L for current position
  let uPnl = 0;
  if (position && currentPrice != null) {
    const dir = position.side === "long" ? 1 : -1;
    uPnl = (currentPrice - position.avgEntry) * position.qty * dir * position.multiplier;
  }

  // Risk-based qty calculation
  const multiplier = assetClass === "future" ? 50 : 1;
  const slDist = Number(slDistance) || 0;
  const riskQty = useRiskSizing && simAccount && slDist > 0
    ? calcRiskQty(simAccount.balance, Number(riskPct) || 1, slDist, multiplier, maxQty ? Number(maxQty) : undefined)
    : qty;
  const effectiveQty = useRiskSizing ? riskQty : qty;
  const riskAmount = simAccount ? simAccount.balance * ((Number(riskPct) || 1) / 100) : 0;

  const handleGoLong = useCallback(() => {
    if (effectiveQty <= 0 || currentPrice == null) return;
    const tp = useBracket && tpDistance ? currentPrice + Number(tpDistance) : undefined;
    const sl = useBracket && slDistance ? currentPrice - Number(slDistance) : undefined;
    onGoLong(effectiveQty, tp, sl);
  }, [effectiveQty, onGoLong, useBracket, tpDistance, slDistance, currentPrice]);

  const handleGoShort = useCallback(() => {
    if (effectiveQty <= 0 || currentPrice == null) return;
    const tp = useBracket && tpDistance ? currentPrice - Number(tpDistance) : undefined;
    const sl = useBracket && slDistance ? currentPrice + Number(slDistance) : undefined;
    onGoShort(effectiveQty, tp, sl);
  }, [effectiveQty, onGoShort, useBracket, tpDistance, slDistance, currentPrice]);

  // Futures qty presets
  const qtyPresets = assetClass === "future" ? [1, 2, 3, 5, 10] : [1, 10, 50, 100, 500];

  // Sync partial qty when position changes (using state reconciliation pattern)
  const [prevPosQty, setPrevPosQty] = useState<number | null>(null);
  const posQty = position?.qty ?? null;
  if (posQty !== prevPosQty) {
    setPrevPosQty(posQty);
    if (posQty != null) setPartialQty(Math.min(1, posQty));
  }

  if (!simAccount) return null;

  const ch = challengeMetrics;

  return (
    <div className="absolute right-2 top-12 z-30 w-[220px] rounded-lg border border-[#2a3040] bg-[#131722]/97 shadow-2xl">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[10px] font-bold uppercase tracking-wide text-blue-400">
          Sim Trading
        </span>
        <span className="text-[10px] text-neutral-500">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="border-t border-[#2a3040] px-3 pb-3 pt-2">
          {/* Account summary */}
          <div className="mb-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
            <span className="text-neutral-500">Balance</span>
            <span className={cn("text-right font-mono", simAccount.balance >= simAccount.startBalance ? "text-green-400" : "text-red-400")}>
              {usd(simAccount.balance)}
            </span>
            <span className="text-neutral-500">P&L</span>
            <span className={cn("text-right font-mono", simAccount.balance - simAccount.startBalance >= 0 ? "text-green-400" : "text-red-400")}>
              {usd(simAccount.balance - simAccount.startBalance)}
            </span>
            {position && (
              <>
                <span className="text-neutral-500">uP&L</span>
                <span className={cn("text-right font-mono", uPnl >= 0 ? "text-green-400" : "text-red-400")}>
                  {usd(uPnl)}
                </span>
              </>
            )}
          </div>

          {/* Position */}
          {position && (
            <div className="mb-2 rounded border border-[#2a3040] bg-[#0d1117] p-1.5 text-[10px]">
              <span className={position.side === "long" ? "text-green-400" : "text-red-400"}>
                {position.side === "long" ? "LONG" : "SHORT"} {position.qty}
              </span>
              {" "}
              <span className="text-neutral-400">
                {symbol} @ {position.avgEntry.toFixed(2)}
              </span>
              <div className="mt-1 flex gap-1">
                <input
                  type="number"
                  min={1}
                  max={position.qty}
                  value={partialQty}
                  onChange={(e) => setPartialQty(Math.max(1, +e.target.value || 1))}
                  className="w-10 rounded border border-[#2a3040] bg-[#0b0e11] px-1 py-0.5 text-center text-[10px] text-neutral-200 outline-none"
                  aria-label="Partial close qty"
                />
                <button
                  onClick={() => onPartialClose(partialQty)}
                  className="flex-1 rounded bg-amber-700/80 px-1 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-600"
                >
                  Close {partialQty}
                </button>
                <button
                  onClick={onFlatten}
                  className="rounded bg-red-800/80 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700"
                >
                  Flat
                </button>
              </div>
            </div>
          )}

          {/* Risk-based sizing toggle */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <input
              type="checkbox"
              id="rtp-risk"
              checked={useRiskSizing}
              onChange={(e) => setUseRiskSizing(e.target.checked)}
              className="accent-amber-500"
            />
            <label htmlFor="rtp-risk" className="text-[10px] text-neutral-400">
              Risk-based sizing
            </label>
          </div>

          {useRiskSizing && (
            <div className="mb-2 grid grid-cols-3 gap-1 text-[10px]">
              <div>
                <span className="text-neutral-500">Risk %</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={riskPct}
                  onChange={(e) => setRiskPct(e.target.value)}
                  className="mt-0.5 w-full rounded border border-[#2a3040] bg-[#0b0e11] px-1 py-0.5 text-center text-neutral-200 outline-none"
                />
              </div>
              <div>
                <span className="text-neutral-500">SL dist</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={slDistance}
                  onChange={(e) => setSlDistance(e.target.value)}
                  placeholder="pts"
                  className="mt-0.5 w-full rounded border border-[#2a3040] bg-[#0b0e11] px-1 py-0.5 text-center text-neutral-200 outline-none"
                />
              </div>
              <div>
                <span className="text-neutral-500">Max qty</span>
                <input
                  type="number"
                  min={1}
                  value={maxQty}
                  onChange={(e) => setMaxQty(e.target.value)}
                  placeholder="∞"
                  className="mt-0.5 w-full rounded border border-[#2a3040] bg-[#0b0e11] px-1 py-0.5 text-center text-neutral-200 outline-none"
                />
              </div>
              <div className="col-span-3 text-[9px] text-neutral-600">
                Risk {usd(riskAmount)} → {riskQty} qty
              </div>
            </div>
          )}

          {/* Bracket order (OCO) */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <input
              type="checkbox"
              id="rtp-bracket"
              checked={useBracket}
              onChange={(e) => setUseBracket(e.target.checked)}
              className="accent-blue-500"
            />
            <label htmlFor="rtp-bracket" className="text-[10px] text-neutral-400">
              Bracket (TP/SL)
            </label>
          </div>

          {useBracket && (
            <div className="mb-2 grid grid-cols-2 gap-1 text-[10px]">
              <div>
                <span className="text-green-500">TP distance</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={tpDistance}
                  onChange={(e) => setTpDistance(e.target.value)}
                  placeholder="pts"
                  className="mt-0.5 w-full rounded border border-[#2a3040] bg-[#0b0e11] px-1 py-0.5 text-center text-neutral-200 outline-none"
                />
              </div>
              <div>
                <span className="text-red-500">SL distance</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={slDistance}
                  onChange={(e) => setSlDistance(e.target.value)}
                  placeholder="pts"
                  className="mt-0.5 w-full rounded border border-[#2a3040] bg-[#0b0e11] px-1 py-0.5 text-center text-neutral-200 outline-none"
                />
              </div>
              {Number(tpDistance) > 0 && Number(slDistance) > 0 && (
                <div className="col-span-2 text-[9px] text-neutral-600">
                  R:R = {(Number(tpDistance) / Number(slDistance)).toFixed(2)}
                </div>
              )}
            </div>
          )}

          {/* Qty input + presets */}
          {!useRiskSizing && (
            <div className="mb-2 flex items-center gap-1">
              {qtyPresets.map((n) => (
                <button
                  key={n}
                  onClick={() => setQty(n)}
                  className={cn(
                    "h-6 rounded px-1.5 text-[10px] font-semibold",
                    qty === n ? "bg-blue-700 text-white" : "bg-[#2a3040] text-neutral-400 hover:text-white",
                  )}
                >
                  {n}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, +e.target.value || 1))}
                className="ml-1 w-12 rounded border border-[#2a3040] bg-[#0b0e11] px-1 py-0.5 text-center text-[10px] text-neutral-200 outline-none"
                aria-label="Order qty"
              />
            </div>
          )}

          {/* Go Long / Go Short */}
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <button
              onClick={handleGoLong}
              className="rounded bg-green-700 py-1.5 text-[11px] font-bold text-white hover:bg-green-600"
            >
              GO LONG {effectiveQty}
            </button>
            <button
              onClick={handleGoShort}
              className="rounded bg-red-700 py-1.5 text-[11px] font-bold text-white hover:bg-red-600"
            >
              GO SHORT {effectiveQty}
            </button>
          </div>

          {/* Challenge metrics */}
          {ch && (
            <div className="rounded border border-[#2a3040] bg-[#0d1117] p-1.5">
              <p className="mb-1 text-[10px] font-bold text-blue-400">
                {simAccount.challenge?.name ?? "Challenge"}
                {ch.passed ? (
                  <span className="ml-1 text-green-400">PASSED</span>
                ) : (
                  <span className="ml-1 text-neutral-500">in progress</span>
                )}
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
                <span className="text-neutral-500">Profit target</span>
                <span className={cn("text-right font-mono", ch.rules.profitTarget.passed ? "text-green-400" : "text-neutral-300")}>
                  {usd(ch.rules.profitTarget.current)} / {usd(ch.rules.profitTarget.target)}
                </span>
                <span className="text-neutral-500">Max loss</span>
                <span className={cn("text-right font-mono", ch.rules.maxLoss.passed ? "text-green-400" : "text-red-400")}>
                  {usd(ch.rules.maxLoss.current)} / {usd(ch.rules.maxLoss.limit)}
                </span>
                <span className="text-neutral-500">Daily loss</span>
                <span className={cn("text-right font-mono", ch.rules.maxDailyLoss.passed ? "text-green-400" : "text-red-400")}>
                  {usd(ch.rules.maxDailyLoss.current)} / {usd(ch.rules.maxDailyLoss.limit)}
                </span>
                <span className="text-neutral-500">Trading days</span>
                <span className={cn("text-right font-mono", ch.rules.minDays.passed ? "text-green-400" : "text-neutral-300")}>
                  {ch.rules.minDays.current} / {ch.rules.minDays.required}
                </span>
                {ch.rules.consistency && (
                  <>
                    <span className="text-neutral-500">Consistency</span>
                    <span className={cn("text-right font-mono", ch.rules.consistency.passed ? "text-green-400" : "text-red-400")}>
                      {ch.rules.consistency.current}% / {ch.rules.consistency.limit}%
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Multi-account copy-trading summary */}
          {copyGroup && copyGroup.copies.length > 0 && (
            <div className="mt-2 rounded border border-purple-900/40 bg-[#0d1117] p-1.5">
              <p className="mb-1 text-[10px] font-bold text-purple-400">
                Copy Trading ({copyGroup.copies.length + 1} accounts)
              </p>
              <div className="mb-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
                <span className="text-neutral-500">Combined P&L</span>
                <span className={cn("text-right font-mono", copyGroupTotalPnl(copyGroup) >= 0 ? "text-green-400" : "text-red-400")}>
                  {usd(copyGroupTotalPnl(copyGroup))}
                </span>
              </div>
              <div className="max-h-28 overflow-y-auto">
                {allCopyAccounts(copyGroup).map((acct) => {
                  const pnl = acct.state.balance - acct.state.startBalance;
                  const pos = acct.state.positions.find((p) => p.symbol === symbol);
                  const acctMetrics = acct.state.challenge ? simChallengeMetrics(acct.state) : null;
                  return (
                    <div key={acct.id} className="flex items-center justify-between border-t border-[#1a1e29] py-0.5 first:border-t-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-neutral-400">
                          {acct.name}
                          {acct.id !== "master" && (
                            <span className="text-purple-500"> {acct.multiplier}x</span>
                          )}
                        </span>
                        {pos && (
                          <span className={cn("text-[8px]", pos.side === "long" ? "text-green-500" : "text-red-500")}>
                            {pos.side === "long" ? "L" : "S"}{pos.qty}
                          </span>
                        )}
                        {acctMetrics?.passed && (
                          <span className="text-[8px] text-green-400">PASS</span>
                        )}
                      </div>
                      <span className={cn("font-mono text-[9px]", pnl >= 0 ? "text-green-400" : "text-red-400")}>
                        {pnl >= 0 ? "+" : ""}{usd(pnl)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bracket status on current position */}
          {position?.bracket && (
            <div className="mt-2 rounded border border-[#2a3040] bg-[#0d1117] p-1.5 text-[9px]">
              <span className="text-neutral-500">Bracket: </span>
              {position.bracket.tp != null && (
                <span className="text-green-400">TP {position.bracket.tp.toFixed(2)} </span>
              )}
              {position.bracket.sl != null && (
                <span className="text-red-400">SL {position.bracket.sl.toFixed(2)}</span>
              )}
            </div>
          )}

          {/* Analytics button */}
          {onOpenAnalytics && (
            <button
              onClick={onOpenAnalytics}
              className="mt-2 w-full rounded bg-neutral-800 py-1 text-[10px] font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-white"
            >
              Performance Analytics
            </button>
          )}
        </div>
      )}
    </div>
  );
}
