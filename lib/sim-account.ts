/**
 * Simulated trading account for replay practice sessions.
 *
 * Tracks positions, fills, P&L, and daily metrics entirely client-side
 * using localStorage persistence. Designed for practicing for FTMO/TopStep
 * challenges with realistic account rules.
 */

/** A single fill (entry or exit). */
export interface SimFill {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  /** Unix seconds from bar time. */
  time: number;
  /** ISO date string in ET (YYYY-MM-DD). */
  date: string;
  /** Realized P&L from this fill (0 for pure opens). */
  realized: number;
  closedQty: number;
  assetClass: "stock" | "future" | "forex";
  /** $ per 1.00 point (futures: tickValue/tickSize; stocks: 1; forex: pip value). */
  multiplier: number;
}

/** An open position in the sim account. */
export interface SimPosition {
  symbol: string;
  side: "long" | "short";
  qty: number;
  avgEntry: number;
  assetClass: "stock" | "future" | "forex";
  multiplier: number;
}

/** Daily P&L bucket — same shape as DayPnl for calendar reuse. */
export interface SimDayPnl {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  opens: number;
  details: SimFill[];
}

/** Challenge preset configuration. */
export interface ChallengeConfig {
  name: string;
  startBalance: number;
  profitTarget: number;
  /** Max cumulative drawdown from peak (trailing or static). */
  maxLoss: number;
  /** Max single-day loss allowed. */
  maxDailyLoss: number;
  /** Min trading days required. */
  minTradingDays: number;
  /** Consistency rule: no single day > X% of total profit. */
  consistencyPct?: number;
}

export const CHALLENGE_PRESETS: Record<string, ChallengeConfig> = {
  "ftmo-100k": {
    name: "FTMO $100K Challenge",
    startBalance: 100_000,
    profitTarget: 10_000,
    maxLoss: 10_000,
    maxDailyLoss: 5_000,
    minTradingDays: 4,
    consistencyPct: 45,
  },
  "ftmo-200k": {
    name: "FTMO $200K Challenge",
    startBalance: 200_000,
    profitTarget: 20_000,
    maxLoss: 20_000,
    maxDailyLoss: 10_000,
    minTradingDays: 4,
    consistencyPct: 45,
  },
  "topstep-50k": {
    name: "TopStep $50K Combine",
    startBalance: 50_000,
    profitTarget: 3_000,
    maxLoss: 2_000,
    maxDailyLoss: 1_000,
    minTradingDays: 0,
  },
  "topstep-100k": {
    name: "TopStep $100K Combine",
    startBalance: 100_000,
    profitTarget: 6_000,
    maxLoss: 3_000,
    maxDailyLoss: 2_000,
    minTradingDays: 0,
  },
  "topstep-150k": {
    name: "TopStep $150K Combine",
    startBalance: 150_000,
    profitTarget: 9_000,
    maxLoss: 4_500,
    maxDailyLoss: 3_000,
    minTradingDays: 0,
  },
  custom: {
    name: "Custom",
    startBalance: 100_000,
    profitTarget: 10_000,
    maxLoss: 10_000,
    maxDailyLoss: 5_000,
    minTradingDays: 0,
  },
};

const SIM_KEY = "sim-account";
const etFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function etDay(unixSec: number): string {
  return etFmt.format(new Date(unixSec * 1000));
}

/** Persistent state shape. */
export interface SimAccountState {
  startBalance: number;
  balance: number;
  peakBalance: number;
  positions: SimPosition[];
  fills: SimFill[];
  challenge: ChallengeConfig | null;
  createdAt: string;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultState(startBalance: number, challenge: ChallengeConfig | null): SimAccountState {
  return {
    startBalance,
    balance: startBalance,
    peakBalance: startBalance,
    positions: [],
    fills: [],
    challenge,
    createdAt: new Date().toISOString(),
  };
}

/** Load from localStorage. */
export function loadSimAccount(): SimAccountState | null {
  try {
    const raw = localStorage.getItem(SIM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SimAccountState;
  } catch {
    return null;
  }
}

/** Save to localStorage. */
export function saveSimAccount(state: SimAccountState): void {
  localStorage.setItem(SIM_KEY, JSON.stringify(state));
}

/** Create or reset sim account. */
export function resetSimAccount(
  startBalance: number,
  challenge: ChallengeConfig | null,
): SimAccountState {
  const state = defaultState(startBalance, challenge);
  saveSimAccount(state);
  return state;
}

/**
 * Open or add to a position. Returns the updated state + the fill.
 * `side` is "buy" or "sell" — maps to long/short.
 */
export function simOpenPosition(
  state: SimAccountState,
  symbol: string,
  side: "buy" | "sell",
  qty: number,
  price: number,
  time: number,
  assetClass: "stock" | "future" | "forex" = "stock",
  multiplier = 1,
): { state: SimAccountState; fill: SimFill } {
  const posSide = side === "buy" ? "long" : "short";
  const existing = state.positions.find(
    (p) => p.symbol === symbol && p.side === posSide,
  );
  const fill: SimFill = {
    id: genId(),
    symbol,
    side,
    qty,
    price,
    time,
    date: etDay(time),
    realized: 0,
    closedQty: 0,
    assetClass,
    multiplier,
  };
  const newState = { ...state, fills: [...state.fills, fill] };

  // Check if there's an opposing position — this is a close/partial close
  const oppSide = posSide === "long" ? "short" : "long";
  const opposing = state.positions.find(
    (p) => p.symbol === symbol && p.side === oppSide,
  );
  if (opposing) {
    return simClosePosition(state, symbol, qty, price, time, assetClass, multiplier);
  }

  if (existing) {
    // Average into existing position
    const totalQty = existing.qty + qty;
    const avgEntry =
      (existing.avgEntry * existing.qty + price * qty) / totalQty;
    newState.positions = state.positions.map((p) =>
      p === existing ? { ...p, qty: totalQty, avgEntry } : p,
    );
  } else {
    newState.positions = [
      ...state.positions,
      { symbol, side: posSide, qty, avgEntry: price, assetClass, multiplier },
    ];
  }
  saveSimAccount(newState);
  return { state: newState, fill };
}

/**
 * Close or reduce a position. Computes realized P&L.
 * Always closes in the direction that reduces the current position.
 */
export function simClosePosition(
  state: SimAccountState,
  symbol: string,
  closeQty: number,
  exitPrice: number,
  time: number,
  assetClass: "stock" | "future" | "forex" = "stock",
  multiplier = 1,
): { state: SimAccountState; fill: SimFill } {
  const pos = state.positions.find((p) => p.symbol === symbol);
  if (!pos) {
    // No position to close — treat as opening in the opposite direction
    const side = "sell"; // default to short if no position
    return simOpenPosition(state, symbol, side, closeQty, exitPrice, time, assetClass, multiplier);
  }

  const actualClose = Math.min(closeQty, pos.qty);
  const direction = pos.side === "long" ? 1 : -1;
  const realized = (exitPrice - pos.avgEntry) * actualClose * direction * pos.multiplier;

  const fill: SimFill = {
    id: genId(),
    symbol,
    side: pos.side === "long" ? "sell" : "buy",
    qty: actualClose,
    price: exitPrice,
    time,
    date: etDay(time),
    realized,
    closedQty: actualClose,
    assetClass: pos.assetClass,
    multiplier: pos.multiplier,
  };

  const newBalance = state.balance + realized;
  const newPeak = Math.max(state.peakBalance, newBalance);

  let newPositions: SimPosition[];
  if (actualClose >= pos.qty) {
    newPositions = state.positions.filter((p) => p !== pos);
  } else {
    newPositions = state.positions.map((p) =>
      p === pos ? { ...p, qty: p.qty - actualClose } : p,
    );
  }

  const newState: SimAccountState = {
    ...state,
    balance: newBalance,
    peakBalance: newPeak,
    positions: newPositions,
    fills: [...state.fills, fill],
  };
  saveSimAccount(newState);
  return { state: newState, fill };
}

/** Flatten all positions at given prices. */
export function simFlatten(
  state: SimAccountState,
  priceMap: Record<string, number>,
  time: number,
): SimAccountState {
  let s = state;
  for (const pos of [...state.positions]) {
    const px = priceMap[pos.symbol] ?? pos.avgEntry;
    const result = simClosePosition(
      s, pos.symbol, pos.qty, px, time, pos.assetClass, pos.multiplier,
    );
    s = result.state;
  }
  return s;
}

/** Compute daily P&L buckets from fills. */
export function simDailyPnl(state: SimAccountState): SimDayPnl[] {
  const byDate = new Map<string, SimFill[]>();
  for (const f of state.fills) {
    const existing = byDate.get(f.date) ?? [];
    existing.push(f);
    byDate.set(f.date, existing);
  }

  const days: SimDayPnl[] = [];
  for (const [date, fills] of byDate) {
    const pnl = fills.reduce((s, f) => s + f.realized, 0);
    const wins = fills.filter((f) => f.closedQty > 0 && f.realized > 0).length;
    const losses = fills.filter((f) => f.closedQty > 0 && f.realized < 0).length;
    const opens = fills.filter((f) => f.closedQty === 0).length;
    days.push({ date, pnl, trades: fills.length, wins, losses, opens, details: fills });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/** Unrealized P&L for all open positions at given prices. */
export function simUnrealizedPnl(
  state: SimAccountState,
  priceMap: Record<string, number>,
): number {
  return state.positions.reduce((total, pos) => {
    const px = priceMap[pos.symbol] ?? pos.avgEntry;
    const dir = pos.side === "long" ? 1 : -1;
    return total + (px - pos.avgEntry) * pos.qty * dir * pos.multiplier;
  }, 0);
}

/** Challenge metrics and pass/fail checks. */
export interface ChallengeMetrics {
  totalPnl: number;
  peakBalance: number;
  drawdownFromPeak: number;
  maxDailyLoss: number;
  worstDay: string | null;
  tradingDays: number;
  /** Largest single-day profit as % of total profit. */
  biggestDayPct: number;
  /** True if all rules pass. */
  passed: boolean;
  /** Per-rule status. */
  rules: {
    profitTarget: { target: number; current: number; passed: boolean };
    maxLoss: { limit: number; current: number; passed: boolean };
    maxDailyLoss: { limit: number; current: number; passed: boolean };
    minDays: { required: number; current: number; passed: boolean };
    consistency?: { limit: number; current: number; passed: boolean };
  };
}

export function simChallengeMetrics(
  state: SimAccountState,
): ChallengeMetrics | null {
  const ch = state.challenge;
  if (!ch) return null;

  const days = simDailyPnl(state);
  const totalPnl = state.balance - state.startBalance;
  const drawdown = state.peakBalance - state.balance;

  let worstDayPnl = 0;
  let worstDay: string | null = null;
  let bestDayPnl = 0;
  for (const d of days) {
    if (d.pnl < worstDayPnl) {
      worstDayPnl = d.pnl;
      worstDay = d.date;
    }
    if (d.pnl > bestDayPnl) bestDayPnl = d.pnl;
  }

  const biggestDayPct = totalPnl > 0 ? (bestDayPnl / totalPnl) * 100 : 0;

  const profitRule = { target: ch.profitTarget, current: totalPnl, passed: totalPnl >= ch.profitTarget };
  const maxLossRule = { limit: ch.maxLoss, current: drawdown, passed: drawdown <= ch.maxLoss };
  const dailyLossRule = { limit: ch.maxDailyLoss, current: Math.abs(worstDayPnl), passed: Math.abs(worstDayPnl) <= ch.maxDailyLoss };
  const daysRule = { required: ch.minTradingDays, current: days.length, passed: days.length >= ch.minTradingDays };

  let consistencyRule: { limit: number; current: number; passed: boolean } | undefined;
  if (ch.consistencyPct != null) {
    consistencyRule = {
      limit: ch.consistencyPct,
      current: Math.round(biggestDayPct),
      passed: biggestDayPct <= ch.consistencyPct,
    };
  }

  const passed = profitRule.passed && maxLossRule.passed && dailyLossRule.passed && daysRule.passed && (consistencyRule?.passed ?? true);

  return {
    totalPnl,
    peakBalance: state.peakBalance,
    drawdownFromPeak: drawdown,
    maxDailyLoss: Math.abs(worstDayPnl),
    worstDay,
    tradingDays: days.length,
    biggestDayPct,
    passed,
    rules: {
      profitTarget: profitRule,
      maxLoss: maxLossRule,
      maxDailyLoss: dailyLossRule,
      minDays: daysRule,
      consistency: consistencyRule,
    },
  };
}
