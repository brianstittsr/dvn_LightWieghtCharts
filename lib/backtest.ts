import type { Candle } from "@/lib/types";

/** Strategies available in the backtest engine. */
export type BacktestStrategyId = "sma-cross" | "rsi-mean" | "donchian";

export const BACKTEST_STRATEGIES: { id: BacktestStrategyId; label: string; blurb: string }[] = [
  { id: "sma-cross", label: "SMA Crossover (10/30)", blurb: "Long when SMA10 > SMA30; flips short in long/short mode." },
  { id: "rsi-mean", label: "RSI Mean Reversion (14)", blurb: "Buy RSI<30, exit >50; short RSI>70, exit <50." },
  { id: "donchian", label: "Donchian Breakout (20/10)", blurb: "Long on 20-bar high break, exit on 10-bar low." },
];

export interface BacktestConfig {
  /** Built-in strategy id, or "custom:<id>" for an AI-generated strategy. */
  strategy: string;
  initialCapital: number;
  /** % of equity risked per trade via ATR stop sizing. */
  riskPerTrade: number;
  /** $ commission per order (charged on entry and exit). */
  commission: number;
  /** % slippage applied adversely to fills. */
  slippagePct: number;
  /** Allow short entries; otherwise exits to flat. */
  longShort: boolean;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: "long" | "short";
  entry: number;
  exit: number;
  qty: number;
  pnl: number;
  exitReason: "signal" | "stop" | "end";
}

export interface BacktestSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  initialCapital: number;
  finalCapital: number;
  totalProfit: number;
  returnPercent: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  bestTrade: number;
  worstTrade: number;
}

export interface BacktestResult {
  id: string;
  symbol: string;
  timeframe: string;
  bars: number;
  startTime: number;
  endTime: number;
  config: BacktestConfig;
  summary: BacktestSummary;
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number }[];
}

type Desired = "long" | "short" | "flat";

/* ---- indicator math (local to keep the engine self-contained) ---- */

function sma(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= period) sum -= vals[i - period];
    if (i + 1 >= period) out[i] = sum / period;
  }
  return out;
}

function rsi(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(vals.length).fill(null);
  let avgG = 0;
  let avgL = 0;
  for (let i = 1; i < vals.length; i++) {
    const ch = vals[i] - vals[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= period) {
      avgG += g / period;
      avgL += l / period;
    } else {
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
    }
    if (i >= period) out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function atr(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(candles.length).fill(null);
  let a = 0;
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    a = i <= period ? a + tr / period : (a * (period - 1) + tr) / period;
    if (i >= period) out[i] = a;
  }
  return out;
}

function ema(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(vals.length).fill(null);
  const k = 2 / (period + 1);
  let e: number | null = null;
  for (let i = 0; i < vals.length; i++) {
    e = e == null ? vals[i] : vals[i] * k + e * (1 - k);
    if (i + 1 >= period) out[i] = e;
  }
  return out;
}

function rollingExtreme(vals: number[], period: number, hi: boolean): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(vals.length).fill(null);
  for (let i = period - 1; i < vals.length; i++) {
    let m = hi ? -Infinity : Infinity;
    for (let j = i - period + 1; j <= i; j++) m = hi ? Math.max(m, vals[j]) : Math.min(m, vals[j]);
    out[i] = m;
  }
  return out;
}

/** Helpers injected into AI-generated strategy code. */
export const strategyHelpers = {
  sma,
  ema,
  rsi,
  atr,
  highest: (vals: number[], period: number) => rollingExtreme(vals, period, true),
  lowest: (vals: number[], period: number) => rollingExtreme(vals, period, false),
};

/**
 * Evaluate AI-generated strategy code. Contract: the body returns an array of
 * "long" | "short" | "flat" per candle. Falls back to calling an inner
 * `fn(candles, params, helpers)` when the body doesn't return directly.
 */
export function desiredFromCode(
  code: string,
  candles: Candle[],
  params: Record<string, unknown>,
): Desired[] {
  type Runner = (c: Candle[], p: Record<string, unknown>, h: typeof strategyHelpers) => unknown;
  const make = (body: string): Runner =>
    new Function("candles", "params", "helpers", body) as Runner;
  let out = make(code)(candles, params, strategyHelpers);
  if (out === undefined) {
    out = make(
      `${code}\n; if (typeof fn === 'function') return fn(candles, params, helpers);`,
    )(candles, params, strategyHelpers);
  }
  if (!Array.isArray(out) || out.length !== candles.length) {
    throw new Error("Strategy code must return an array of \"long\"/\"short\"/\"flat\" matching candles.length");
  }
  return out.map((v): Desired => (v === "long" || v === "short" ? v : "flat"));
}

/**
 * Desired position at each bar close. The engine transitions at the next
 * bar's open, so strategies never see the future.
 */
function desiredPositions(id: string, candles: Candle[], longShort: boolean): Desired[] {
  const n = candles.length;
  const flat: Desired[] = new Array<Desired>(n).fill("flat");
  const closes = candles.map((c) => c.close);

  if (id === "sma-cross") {
    const fast = sma(closes, 10);
    const slow = sma(closes, 30);
    for (let i = 0; i < n; i++) {
      const f = fast[i];
      const s = slow[i];
      if (f == null || s == null) continue;
      flat[i] = f > s ? "long" : longShort ? "short" : "flat";
    }
    return flat;
  }

  if (id === "rsi-mean") {
    const r = rsi(closes, 14);
    let pos: Desired = "flat";
    for (let i = 0; i < n; i++) {
      const v = r[i];
      if (v != null) {
        if (pos === "flat") {
          if (v < 30) pos = "long";
          else if (longShort && v > 70) pos = "short";
        } else if (pos === "long" && v > 50) pos = "flat";
        else if (pos === "short" && v < 50) pos = "flat";
      }
      flat[i] = pos;
    }
    return flat;
  }

  // donchian: enter on 20-bar channel break, exit on opposite 10-bar touch.
  let pos: Desired = "flat";
  for (let i = 0; i < n; i++) {
    if (i >= 20) {
      let hh = -Infinity;
      let ll = Infinity;
      let exitLo = Infinity;
      let exitHi = -Infinity;
      for (let j = i - 20; j < i; j++) {
        hh = Math.max(hh, candles[j].high);
        ll = Math.min(ll, candles[j].low);
        if (j >= i - 10) {
          exitLo = Math.min(exitLo, candles[j].low);
          exitHi = Math.max(exitHi, candles[j].high);
        }
      }
      const c = closes[i];
      if (pos === "flat") {
        if (c > hh) pos = "long";
        else if (longShort && c < ll) pos = "short";
      } else if (pos === "long" && c < exitLo) pos = "flat";
      else if (pos === "short" && c > exitHi) pos = "flat";
    }
    flat[i] = pos;
  }
  return flat;
}

/**
 * Run a strategy over the candles loaded in a chart pane. Entries/exits fill
 * at the next bar's open with adverse slippage; a 2×ATR(14) stop is checked
 * against intrabar extremes (stop is checked before the signal on the same
 * bar — conservative).
 */
export function runBacktest(
  candles: Candle[],
  cfg: BacktestConfig,
  symbol: string,
  timeframe: string,
  custom?: { code: string; params?: Record<string, unknown> },
): BacktestResult {
  const n = candles.length;
  const desired =
    cfg.strategy.startsWith("custom:") && custom
      ? desiredFromCode(custom.code, candles, custom.params ?? {})
      : desiredPositions(cfg.strategy, candles, cfg.longShort);
  const atrVals = atr(candles, 14);
  const slip = cfg.slippagePct / 100;

  const trades: BacktestTrade[] = [];
  let equity = cfg.initialCapital;
  const equityCurve: { time: number; equity: number }[] = [{ time: candles[0].time, equity }];

  interface Pos {
    side: "long" | "short";
    entry: number;
    qty: number;
    stop: number;
    entryTime: number;
  }
  let pos: Pos | null = null;

  const close = (i: number, price: number, reason: BacktestTrade["exitReason"]): void => {
    if (!pos) return;
    const exit = pos.side === "long" ? price * (1 - slip) : price * (1 + slip);
    const gross = (exit - pos.entry) * pos.qty * (pos.side === "long" ? 1 : -1);
    const pnl = gross - cfg.commission * 2;
    equity += pnl;
    trades.push({
      entryTime: pos.entryTime,
      exitTime: candles[i].time,
      side: pos.side,
      entry: pos.entry,
      exit,
      qty: pos.qty,
      pnl,
      exitReason: reason,
    });
    equityCurve.push({ time: candles[i].time, equity });
    pos = null;
  };

  for (let i = 1; i < n; i++) {
    const bar = candles[i];
    const want = desired[i - 1];

    // Stop check first (conservative: stop fills before same-bar signal exits).
    if (pos) {
      const stopped =
        pos.side === "long" ? bar.low <= pos.stop : bar.high >= pos.stop;
      if (stopped) close(i, pos.stop, "stop");
    }
    if (pos && want !== pos.side) close(i, bar.open, "signal");

    if (!pos && want !== "flat") {
      const a = atrVals[i] ?? bar.close * 0.01;
      const stopDist = Math.max(a * 2, bar.open * 0.001);
      const risk$ = equity * (cfg.riskPerTrade / 100);
      let qty = risk$ / stopDist;
      qty = Math.min(qty, equity / bar.open); // no leverage
      if (qty > 0 && equity > 0) {
        const entryPx: number =
          want === "long" ? bar.open * (1 + slip) : bar.open * (1 - slip);
        const stopPx: number =
          want === "long" ? entryPx - stopDist : entryPx + stopDist;
        pos = { side: want, entry: entryPx, qty, stop: stopPx, entryTime: bar.time };
      }
    }
  }
  if (pos) close(n - 1, candles[n - 1].close, "end");

  /* ---- summary metrics ---- */
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalProfit = equity - cfg.initialCapital;

  let peak = cfg.initialCapital;
  let maxDd = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    maxDd = Math.max(maxDd, peak - p.equity);
  }

  const summary: BacktestSummary = {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    initialCapital: cfg.initialCapital,
    finalCapital: equity,
    totalProfit,
    returnPercent: cfg.initialCapital > 0 ? (totalProfit / cfg.initialCapital) * 100 : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdown: maxDd,
    maxDrawdownPercent: peak > 0 ? (maxDd / peak) * 100 : 0,
    bestTrade: trades.length ? Math.max(...trades.map((t) => t.pnl)) : 0,
    worstTrade: trades.length ? Math.min(...trades.map((t) => t.pnl)) : 0,
  };

  return {
    id: `BT-${Date.now().toString(36)}`,
    symbol,
    timeframe,
    bars: n,
    startTime: candles[0].time,
    endTime: candles[n - 1].time,
    config: cfg,
    summary,
    trades,
    equityCurve,
  };
}
