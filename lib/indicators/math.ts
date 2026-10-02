import type { Candle } from "@/lib/types";
import type { IndicatorSeries, ParamDef, ParamValues } from "./types";

export const SOURCES = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"] as const;
export type Source = (typeof SOURCES)[number];

export function src(c: Candle, s: Source): number {
  switch (s) {
    case "open": return c.open;
    case "high": return c.high;
    case "low": return c.low;
    case "hl2": return (c.high + c.low) / 2;
    case "hlc3": return (c.high + c.low + c.close) / 3;
    case "ohlc4": return (c.open + c.high + c.low + c.close) / 4;
    default: return c.close;
  }
}

export function num(p: ParamValues, k: string, d: number): number {
  const v = p[k];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

export function color(p: ParamValues, k: string, d: string): string {
  const v = p[k];
  return typeof v === "string" && v ? v : d;
}

export function sourceParam(def: Source = "close"): ParamDef {
  return { key: "source", label: "Source", type: "source", default: def };
}
export function lengthParam(def: number): ParamDef {
  return { key: "length", label: "Length", type: "number", default: def, min: 1, max: 500, step: 1 };
}
export function colorParam(key: string, label: string, def: string): ParamDef {
  return { key, label, type: "color", default: def };
}

/** Compute a sliding-window aggregate over `values` (same length as candles). */
export function windowed(values: number[], period: number, fn: (win: number[], i: number) => number): (number | null)[] {
  return values.map((_, i) => (i + 1 >= period ? fn(values.slice(i + 1 - period, i + 1), i) : null));
}

export function toSeries(key: string, label: string, color: string, candles: Candle[], vals: (number | null)[]): IndicatorSeries {
  return { key, label, color, values: candles.map((c, i) => ({ time: c.time, value: vals[i] })) };
}

export function sma(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= period) sum -= vals[i - period];
    if (i + 1 >= period) out[i] = sum / period;
  }
  return out;
}

export function ema(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  const k = 2 / (period + 1);
  let e: number | null = null;
  for (let i = 0; i < vals.length; i++) {
    e = e == null ? vals[i] : vals[i] * k + e * (1 - k);
    if (i + 1 >= period) out[i] = e;
  }
  return out;
}

/** Wilder's moving average (RMA) — used by RSI/ATR/ADX. */
export function rma(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i < period) continue;
    if (i === period) {
      out[i] = sum / period;
    } else {
      out[i] = (out[i - 1]! * (period - 1) + vals[i]) / period;
    }
  }
  return out;
}

export function wma(vals: number[], period: number): (number | null)[] {
  const denom = (period * (period + 1)) / 2;
  return windowed(vals, period, (win) => win.reduce((acc, v, j) => acc + v * (j + 1), 0) / denom);
}

export function stdev(vals: number[], period: number, means: (number | null)[]): (number | null)[] {
  return windowed(vals, period, (win, i) => {
    const m = means[i];
    if (m == null) return 0;
    return Math.sqrt(win.reduce((acc, v) => acc + (v - m) ** 2, 0) / period);
  });
}

export function tr(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

/** Hull Moving Average: WMA(2·WMA(n/2) − WMA(n), √n). */
export function hma(vals: number[], period: number): (number | null)[] {
  const half = Math.max(1, Math.round(period / 2));
  const root = Math.max(1, Math.round(Math.sqrt(period)));
  const wHalf = wma(vals, half);
  const wFull = wma(vals, period);
  const diff = vals.map((_, i) =>
    wHalf[i] == null || wFull[i] == null ? 0 : 2 * wHalf[i]! - wFull[i]!,
  );
  const out: (number | null)[] = new Array(vals.length).fill(null);
  const warmed = half + period - 2;
  // WMA over the diff series once enough inputs exist.
  const denom = (root * (root + 1)) / 2;
  for (let i = warmed; i < vals.length; i++) {
    if (i + 1 < warmed + root) continue;
    let acc = 0;
    for (let j = 0; j < root; j++) acc += diff[i - root + 1 + j] * (j + 1);
    out[i] = acc / denom;
  }
  return out;
}
