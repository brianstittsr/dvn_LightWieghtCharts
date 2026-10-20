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

/** A bracket (OCO) order attached to a position. */
export interface SimBracketOrder {
  positionSymbol: string;
  tp: number | null;
  sl: number | null;
}

/** An open position in the sim account. */
export interface SimPosition {
  symbol: string;
  side: "long" | "short";
  qty: number;
  avgEntry: number;
  assetClass: "stock" | "future" | "forex";
  multiplier: number;
  /** Attached bracket (TP/SL). Null means no bracket. */
  bracket?: SimBracketOrder | null;
}

/** A completed round-trip trade for journal/analytics. */
export interface SimRoundTrip {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  qty: number;
  entryTime: number;
  exitTime: number;
  realized: number;
  /** Risk:reward achieved (SL distance / actual move). */
  rr?: number;
  assetClass: "stock" | "future" | "forex";
  multiplier: number;
  /** User journal note. */
  note?: string;
  /** Comma-separated setup tags. */
  tags?: string;
}

/** Performance analytics computed from round-trip trades. */
export interface SimPerformance {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRR: number;
  largestWin: number;
  largestLoss: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  currentStreak: number; // positive = wins, negative = losses
  byHour: Record<number, { pnl: number; trades: number }>;
  byDayOfWeek: Record<number, { pnl: number; trades: number }>;
  equityCurve: { time: number; balance: number }[];
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

// ── Multi-account copy-trading ───────────────────────────────────

/** A named sub-account inside a copy-trade group. */
export interface CopyAccount {
  id: string;
  name: string;
  /** Qty multiplier relative to the master order. 1 = same size, 2 = double, 0.5 = half. */
  multiplier: number;
  state: SimAccountState;
}

/** A group of accounts that receive copy-traded fills from a master account. */
export interface CopyTradeGroup {
  id: string;
  name: string;
  /** The master (lead) account — trades are placed here first. */
  master: SimAccountState;
  /** Copy accounts that mirror the master's trades with optional scaling. */
  copies: CopyAccount[];
  createdAt: string;
}

const COPY_GROUP_KEY = "sim-copy-group";

/** Load the copy-trade group from localStorage. */
export function loadCopyGroup(): CopyTradeGroup | null {
  try {
    const raw = localStorage.getItem(COPY_GROUP_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CopyTradeGroup;
  } catch {
    return null;
  }
}

/** Save the copy-trade group to localStorage. */
export function saveCopyGroup(group: CopyTradeGroup): void {
  localStorage.setItem(COPY_GROUP_KEY, JSON.stringify(group));
}

/** Create a new copy-trade group. */
export function createCopyGroup(
  name: string,
  masterBalance: number,
  masterChallenge: ChallengeConfig | null,
  copies: { name: string; balance: number; multiplier: number; challenge: ChallengeConfig | null }[],
): CopyTradeGroup {
  const group: CopyTradeGroup = {
    id: genId(),
    name,
    master: defaultState(masterBalance, masterChallenge),
    copies: copies.map((c) => ({
      id: genId(),
      name: c.name,
      multiplier: c.multiplier,
      state: defaultState(c.balance, c.challenge),
    })),
    createdAt: new Date().toISOString(),
  };
  saveCopyGroup(group);
  return group;
}

/** Add a copy account to an existing group. */
export function addCopyAccount(
  group: CopyTradeGroup,
  name: string,
  balance: number,
  multiplier: number,
  challenge: ChallengeConfig | null,
): CopyTradeGroup {
  const newGroup: CopyTradeGroup = {
    ...group,
    copies: [
      ...group.copies,
      {
        id: genId(),
        name,
        multiplier,
        state: defaultState(balance, challenge),
      },
    ],
  };
  saveCopyGroup(newGroup);
  return newGroup;
}

/** Remove a copy account by id. */
export function removeCopyAccount(
  group: CopyTradeGroup,
  accountId: string,
): CopyTradeGroup {
  const newGroup: CopyTradeGroup = {
    ...group,
    copies: group.copies.filter((c) => c.id !== accountId),
  };
  saveCopyGroup(newGroup);
  return newGroup;
}

/**
 * Execute a trade on the master and copy it to all linked accounts.
 * Returns the updated group.
 */
export function copyTradeOpen(
  group: CopyTradeGroup,
  symbol: string,
  side: "buy" | "sell",
  masterQty: number,
  price: number,
  time: number,
  assetClass: "stock" | "future" | "forex" = "stock",
  multiplier = 1,
): CopyTradeGroup {
  // Execute on master
  const masterResult = simOpenPosition(
    group.master, symbol, side, masterQty, price, time, assetClass, multiplier,
  );

  // Execute on each copy account with scaled qty
  const newCopies = group.copies.map((copy) => {
    const scaledQty = Math.max(1, Math.round(masterQty * copy.multiplier));
    const result = simOpenPosition(
      copy.state, symbol, side, scaledQty, price, time, assetClass, multiplier,
    );
    return { ...copy, state: result.state };
  });

  const newGroup: CopyTradeGroup = {
    ...group,
    master: masterResult.state,
    copies: newCopies,
  };
  saveCopyGroup(newGroup);
  return newGroup;
}

/**
 * Close a position on the master and copy to all linked accounts.
 */
export function copyTradeClose(
  group: CopyTradeGroup,
  symbol: string,
  masterCloseQty: number,
  exitPrice: number,
  time: number,
  assetClass: "stock" | "future" | "forex" = "stock",
  multiplier = 1,
): CopyTradeGroup {
  const masterResult = simClosePosition(
    group.master, symbol, masterCloseQty, exitPrice, time, assetClass, multiplier,
  );

  const newCopies = group.copies.map((copy) => {
    // Scale close qty proportionally — close the same fraction of position
    const masterPos = group.master.positions.find((p) => p.symbol === symbol);
    const copyPos = copy.state.positions.find((p) => p.symbol === symbol);
    if (!copyPos) return copy;

    let scaledClose: number;
    if (masterPos && masterPos.qty > 0) {
      // Close the same fraction as master
      const fraction = masterCloseQty / (masterPos.qty + masterCloseQty); // fraction of original position being closed
      scaledClose = Math.max(1, Math.round(copyPos.qty * fraction));
    } else {
      // Master fully closed — flatten copy too
      scaledClose = copyPos.qty;
    }

    const result = simClosePosition(
      copy.state, symbol, scaledClose, exitPrice, time, assetClass, multiplier,
    );
    return { ...copy, state: result.state };
  });

  const newGroup: CopyTradeGroup = {
    ...group,
    master: masterResult.state,
    copies: newCopies,
  };
  saveCopyGroup(newGroup);
  return newGroup;
}

/** Flatten all positions across master and all copies. */
export function copyTradeFlatten(
  group: CopyTradeGroup,
  priceMap: Record<string, number>,
  time: number,
): CopyTradeGroup {
  const newMaster = simFlatten(group.master, priceMap, time);
  const newCopies = group.copies.map((copy) => ({
    ...copy,
    state: simFlatten(copy.state, priceMap, time),
  }));
  const newGroup: CopyTradeGroup = { ...group, master: newMaster, copies: newCopies };
  saveCopyGroup(newGroup);
  return newGroup;
}

/** Reset a specific copy account. */
export function resetCopyAccount(
  group: CopyTradeGroup,
  accountId: string,
): CopyTradeGroup {
  const newGroup: CopyTradeGroup = {
    ...group,
    copies: group.copies.map((c) =>
      c.id === accountId
        ? { ...c, state: defaultState(c.state.startBalance, c.state.challenge) }
        : c,
    ),
  };
  saveCopyGroup(newGroup);
  return newGroup;
}

/** Reset the entire group (master + all copies). */
export function resetCopyGroup(group: CopyTradeGroup): CopyTradeGroup {
  const newGroup: CopyTradeGroup = {
    ...group,
    master: defaultState(group.master.startBalance, group.master.challenge),
    copies: group.copies.map((c) => ({
      ...c,
      state: defaultState(c.state.startBalance, c.state.challenge),
    })),
  };
  saveCopyGroup(newGroup);
  return newGroup;
}

/** Aggregate P&L across master + all copy accounts. */
export function copyGroupTotalPnl(group: CopyTradeGroup): number {
  const masterPnl = group.master.balance - group.master.startBalance;
  const copiesPnl = group.copies.reduce(
    (s, c) => s + (c.state.balance - c.state.startBalance), 0,
  );
  return masterPnl + copiesPnl;
}

/** Total balance across all accounts. */
export function copyGroupTotalBalance(group: CopyTradeGroup): number {
  return group.master.balance + group.copies.reduce((s, c) => s + c.state.balance, 0);
}

/** Get all accounts as a flat list (master first, then copies). */
export function allCopyAccounts(group: CopyTradeGroup): { id: string; name: string; multiplier: number; state: SimAccountState }[] {
  return [
    { id: "master", name: "Master", multiplier: 1, state: group.master },
    ...group.copies,
  ];
}

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

// ── Bracket Orders (OCO) ─────────────────────────────────────────

/** Attach a bracket (TP/SL) to the current position for a symbol. */
export function simSetBracket(
  state: SimAccountState,
  symbol: string,
  tp: number | null,
  sl: number | null,
): SimAccountState {
  const newState: SimAccountState = {
    ...state,
    positions: state.positions.map((p) =>
      p.symbol === symbol
        ? { ...p, bracket: { positionSymbol: symbol, tp, sl } }
        : p,
    ),
  };
  saveSimAccount(newState);
  return newState;
}

/**
 * Check bracket orders against a bar's high/low/close.
 * Returns updated state + any fills triggered.
 * Checks SL first (worst case), then TP.
 */
export function simCheckBrackets(
  state: SimAccountState,
  bar: { high: number; low: number; close: number; time: number },
  symbol: string,
): { state: SimAccountState; triggered: SimFill[] } {
  const triggered: SimFill[] = [];
  let s = state;

  const pos = s.positions.find((p) => p.symbol === symbol && p.bracket);
  if (!pos || !pos.bracket) return { state: s, triggered };

  const { tp, sl } = pos.bracket;

  // Check SL first (price goes against us)
  if (sl != null) {
    const slHit = pos.side === "long" ? bar.low <= sl : bar.high >= sl;
    if (slHit) {
      const result = simClosePosition(
        s, symbol, pos.qty, sl, bar.time, pos.assetClass, pos.multiplier,
      );
      s = result.state;
      triggered.push(result.fill);
      return { state: s, triggered };
    }
  }

  // Check TP
  if (tp != null) {
    const tpHit = pos.side === "long" ? bar.high >= tp : bar.low <= tp;
    if (tpHit) {
      const result = simClosePosition(
        s, symbol, pos.qty, tp, bar.time, pos.assetClass, pos.multiplier,
      );
      s = result.state;
      triggered.push(result.fill);
      return { state: s, triggered };
    }
  }

  return { state: s, triggered };
}

// ── Risk-Based Position Sizing ───────────────────────────────────

/**
 * Calculate position qty based on account risk % and stop distance.
 * @param balance Current account balance
 * @param riskPct Risk percentage (e.g. 1 = 1% of balance)
 * @param stopDistance Absolute price distance from entry to stop
 * @param multiplier $ per point (futures: tick value, stocks: 1)
 * @param maxQty Optional hard cap on qty
 */
export function calcRiskQty(
  balance: number,
  riskPct: number,
  stopDistance: number,
  multiplier = 1,
  maxQty?: number,
): number {
  if (stopDistance <= 0 || riskPct <= 0) return 1;
  const riskAmount = balance * (riskPct / 100);
  const raw = riskAmount / (stopDistance * multiplier);
  const qty = Math.max(1, Math.floor(raw));
  return maxQty != null ? Math.min(qty, maxQty) : qty;
}

// ── Round-Trip Trade Extraction ──────────────────────────────────

const JOURNAL_KEY = "sim-journal";

/** Extract round-trip trades from fills (pair opens with closes). */
export function extractRoundTrips(state: SimAccountState): SimRoundTrip[] {
  // Load existing journal notes
  const notes = loadJournalNotes();

  const trips: SimRoundTrip[] = [];
  // Track open lots: { price, qty, time }[]
  const openLots: Map<string, { price: number; qty: number; time: number; side: "long" | "short" }[]> = new Map();

  for (const fill of state.fills) {
    const key = fill.symbol;
    const posSide = fill.side === "buy" ? "long" : "short";

    if (fill.closedQty > 0 && fill.realized !== 0) {
      // This is a closing fill — match with open lots
      const lots = openLots.get(key) ?? [];
      let remaining = fill.closedQty;

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        const entryPrice = lot.price;
        const tripId = fill.id + "-" + matched;
        const journal = notes[tripId] ?? notes[fill.id];

        trips.push({
          id: tripId,
          symbol: fill.symbol,
          side: lot.side,
          entryPrice,
          exitPrice: fill.price,
          qty: matched,
          entryTime: lot.time,
          exitTime: fill.time,
          realized: fill.realized * (matched / fill.closedQty),
          assetClass: fill.assetClass,
          multiplier: fill.multiplier,
          note: journal?.note,
          tags: journal?.tags,
        });

        remaining -= matched;
        lot.qty -= matched;
        if (lot.qty <= 0) lots.shift();
      }

      openLots.set(key, lots);
    } else if (fill.closedQty === 0) {
      // Opening fill — add to lots
      const lots = openLots.get(key) ?? [];
      lots.push({ price: fill.price, qty: fill.qty, time: fill.time, side: posSide });
      openLots.set(key, lots);
    }
  }

  return trips;
}

// ── Trade Journal ────────────────────────────────────────────────

interface JournalEntry {
  note: string;
  tags: string;
}

function loadJournalNotes(): Record<string, JournalEntry> {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, JournalEntry>;
  } catch {
    return {};
  }
}

export function saveJournalNote(tradeId: string, note: string, tags: string): void {
  const notes = loadJournalNotes();
  notes[tradeId] = { note, tags };
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(notes));
}

export function loadJournalNote(tradeId: string): JournalEntry | null {
  return loadJournalNotes()[tradeId] ?? null;
}

// ── Performance Analytics ────────────────────────────────────────

export function simPerformance(state: SimAccountState): SimPerformance {
  const trips = extractRoundTrips(state);
  const totalTrades = trips.length;

  const wins = trips.filter((t) => t.realized > 0).length;
  const losses = trips.filter((t) => t.realized < 0).length;
  const breakeven = trips.filter((t) => t.realized === 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  const winAmounts = trips.filter((t) => t.realized > 0).map((t) => t.realized);
  const lossAmounts = trips.filter((t) => t.realized < 0).map((t) => t.realized);

  const avgWin = winAmounts.length > 0 ? winAmounts.reduce((s, v) => s + v, 0) / winAmounts.length : 0;
  const avgLoss = lossAmounts.length > 0 ? Math.abs(lossAmounts.reduce((s, v) => s + v, 0) / lossAmounts.length) : 0;

  const grossWins = winAmounts.reduce((s, v) => s + v, 0);
  const grossLosses = Math.abs(lossAmounts.reduce((s, v) => s + v, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  const expectancy = totalTrades > 0
    ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss
    : 0;

  // Average R:R achieved
  const rrs = trips.map((t) => {
    if (t.realized <= 0 || avgLoss === 0) return 0;
    return t.realized / avgLoss;
  });
  const avgRR = rrs.length > 0 ? rrs.reduce((s, v) => s + v, 0) / rrs.length : 0;

  const largestWin = winAmounts.length > 0 ? Math.max(...winAmounts) : 0;
  const largestLoss = lossAmounts.length > 0 ? Math.min(...lossAmounts) : 0;

  // Consecutive wins/losses
  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let curWins = 0;
  let curLosses = 0;
  for (const t of trips) {
    if (t.realized > 0) {
      curWins++;
      curLosses = 0;
      maxConsecWins = Math.max(maxConsecWins, curWins);
    } else if (t.realized < 0) {
      curLosses++;
      curWins = 0;
      maxConsecLosses = Math.max(maxConsecLosses, curLosses);
    } else {
      curWins = 0;
      curLosses = 0;
    }
  }
  const currentStreak = curWins > 0 ? curWins : -curLosses;

  // P&L by hour of day (ET)
  const byHour: Record<number, { pnl: number; trades: number }> = {};
  const byDayOfWeek: Record<number, { pnl: number; trades: number }> = {};
  for (const t of trips) {
    const d = new Date(t.exitTime * 1000);
    // Convert to ET
    const etStr = d.toLocaleString("en-US", { timeZone: "America/New_York" });
    const etDate = new Date(etStr);
    const hour = etDate.getHours();
    const dow = etDate.getDay();

    if (!byHour[hour]) byHour[hour] = { pnl: 0, trades: 0 };
    byHour[hour].pnl += t.realized;
    byHour[hour].trades++;

    if (!byDayOfWeek[dow]) byDayOfWeek[dow] = { pnl: 0, trades: 0 };
    byDayOfWeek[dow].pnl += t.realized;
    byDayOfWeek[dow].trades++;
  }

  // Equity curve
  let bal = state.startBalance;
  const equityCurve: { time: number; balance: number }[] = [{ time: 0, balance: bal }];
  for (const t of trips) {
    bal += t.realized;
    equityCurve.push({ time: t.exitTime, balance: bal });
  }

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    avgRR,
    largestWin,
    largestLoss,
    maxConsecWins,
    maxConsecLosses,
    currentStreak,
    byHour,
    byDayOfWeek,
    equityCurve,
  };
}
