import type { IndicatorDef } from "./types";
import { SESSION_INDICATORS } from "./sessions";
import { OSCILLATOR_INDICATORS } from "./oscillators";
import { color, colorParam, ema, hma, lengthParam, num, sma, sourceParam, src, stdev, toSeries, tr, windowed, wma, type Source } from "./math";

export { SOURCES } from "./math";

export const BUILTIN_INDICATORS: IndicatorDef[] = [...SESSION_INDICATORS, ...OSCILLATOR_INDICATORS,
  {
    id: "sbc",
    name: "SBC — Small Body Candles",
    params: [
      { key: "maxBody", label: "Max body % of range", type: "number", default: 50, min: 5, max: 95, step: 5 },
      colorParam("color", "Highlight color", "#f7931a"),
    ],
    compute(candles, p) {
      const pct = num(p, "maxBody", 50) / 100;
      const tint = color(p, "color", "#f7931a");
      const barColors = candles
        .filter((c) => {
          const range = c.high - c.low;
          return range > 0 && Math.abs(c.close - c.open) / range < pct;
        })
        .map((c) => ({ time: c.time, color: tint }));
      return { series: [], barColors };
    },
  },
  {
    id: "sma",
    name: "SMA — Simple Moving Average",
    params: [lengthParam(20), sourceParam(), colorParam("color", "Color", "#f59e0b")],
    compute(candles, p) {
      const vals = candles.map((c) => src(c, p.source as Source));
      return { series: [toSeries("sma", `SMA ${num(p, "length", 20)}`, color(p, "color", "#f59e0b"), candles, sma(vals, num(p, "length", 20)))] };
    },
  },
  {
    id: "ema",
    name: "EMA — Exponential Moving Average",
    params: [lengthParam(20), sourceParam(), colorParam("color", "Color", "#3b82f6")],
    compute(candles, p) {
      const vals = candles.map((c) => src(c, p.source as Source));
      return { series: [toSeries("ema", `EMA ${num(p, "length", 20)}`, color(p, "color", "#3b82f6"), candles, ema(vals, num(p, "length", 20)))] };
    },
  },
  {
    id: "wma",
    name: "WMA — Weighted Moving Average",
    params: [lengthParam(20), sourceParam(), colorParam("color", "Color", "#a855f7")],
    compute(candles, p) {
      const vals = candles.map((c) => src(c, p.source as Source));
      return { series: [toSeries("wma", `WMA ${num(p, "length", 20)}`, color(p, "color", "#a855f7"), candles, wma(vals, num(p, "length", 20)))] };
    },
  },
  {
    id: "bb",
    name: "BB — Bollinger Bands",
    params: [lengthParam(20), sourceParam(), { key: "mult", label: "StdDev Mult", type: "number", default: 2, min: 0.1, max: 10, step: 0.1 }, colorParam("color", "Color", "#60a5fa")],
    compute(candles, p) {
      const len = num(p, "length", 20);
      const mult = num(p, "mult", 2);
      const col = color(p, "color", "#60a5fa");
      const vals = candles.map((c) => src(c, p.source as Source));
      const basis = sma(vals, len);
      const sd = stdev(vals, len, basis);
      const upper = basis.map((b, i) => (b == null || sd[i] == null ? null : b + mult * sd[i]!));
      const lower = basis.map((b, i) => (b == null || sd[i] == null ? null : b - mult * sd[i]!));
      return {
        series: [
          toSeries("upper", "BB Upper", col, candles, upper),
          toSeries("basis", "BB Basis", col, candles, basis),
          toSeries("lower", "BB Lower", col, candles, lower),
        ],
      };
    },
  },
  {
    id: "keltner",
    name: "KC — Keltner Channel",
    params: [lengthParam(20), { key: "mult", label: "ATR Mult", type: "number", default: 2, min: 0.1, max: 10, step: 0.1 }, colorParam("color", "Color", "#22d3ee")],
    compute(candles, p) {
      const len = num(p, "length", 20);
      const mult = num(p, "mult", 2);
      const col = color(p, "color", "#22d3ee");
      const closes = candles.map((c) => c.close);
      const basis = ema(closes, len);
      const atr = ema(tr(candles), len);
      const upper = basis.map((b, i) => (b == null || atr[i] == null ? null : b + mult * atr[i]!));
      const lower = basis.map((b, i) => (b == null || atr[i] == null ? null : b - mult * atr[i]!));
      return {
        series: [
          toSeries("upper", "KC Upper", col, candles, upper),
          toSeries("basis", "KC Basis", col, candles, basis),
          toSeries("lower", "KC Lower", col, candles, lower),
        ],
      };
    },
  },
  {
    id: "donchian",
    name: "DC — Donchian Channel",
    params: [lengthParam(20), colorParam("color", "Color", "#f472b6")],
    compute(candles, p) {
      const len = num(p, "length", 20);
      const col = color(p, "color", "#f472b6");
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const upper = windowed(highs, len, (win) => Math.max(...win));
      const lower = windowed(lows, len, (win) => Math.min(...win));
      const basis = upper.map((u, i) => (u == null || lower[i] == null ? null : (u + lower[i]!) / 2));
      return {
        series: [
          toSeries("upper", "DC Upper", col, candles, upper),
          toSeries("basis", "DC Basis", col, candles, basis),
          toSeries("lower", "DC Lower", col, candles, lower),
        ],
      };
    },
  },
  {
    id: "hma",
    name: "HMA — Hull Moving Average",
    params: [lengthParam(21), sourceParam(), colorParam("color", "Color", "#fb923c")],
    compute(candles, p) {
      const vals = candles.map((c) => src(c, p.source as Source));
      return { series: [toSeries("hma", `HMA ${num(p, "length", 21)}`, color(p, "color", "#fb923c"), candles, hma(vals, num(p, "length", 21)))] };
    },
  },
  {
    id: "vwap",
    name: "VWAP — Volume Weighted Avg Price (daily)",
    params: [colorParam("color", "Color", "#e879f9")],
    compute(candles, p) {
      const col = color(p, "color", "#e879f9");
      let pv = 0;
      let vol = 0;
      let day = -1;
      const vals = candles.map((c) => {
        const d = Math.floor(c.time / 86400);
        if (d !== day) {
          day = d;
          pv = 0;
          vol = 0;
        }
        const tp = (c.high + c.low + c.close) / 3;
        const v = c.volume ?? 1;
        pv += tp * v;
        vol += v;
        return vol > 0 ? pv / vol : null;
      });
      return { series: [toSeries("vwap", "VWAP", col, candles, vals)] };
    },
  },
  {
    id: "avwap",
    name: "AVWAP — Anchored VWAP",
    params: [
      {
        key: "anchor",
        label: "Anchor (0=N bars back, 1=day, 2=week, 3=month, 4=year, 5=first bar, 6=clicked bar)",
        type: "number",
        default: 2,
        min: 0,
        max: 6,
        step: 1,
      },
      { key: "barsBack", label: "N bars (anchor=0)", type: "number", default: 50, min: 1, max: 5000, step: 1 },
      { key: "anchorTime", label: "Anchor time, unix (anchor=6 — set by ⚓ tool)", type: "number", default: 0, min: 0, max: 9999999999, step: 1 },
      sourceParam("hlc3"),
      colorParam("color", "Color", "#38bdf8"),
    ],
    compute(candles, p) {
      const col = color(p, "color", "#38bdf8");
      const mode = num(p, "anchor", 2);
      const last = candles[candles.length - 1];

      // Resolve the anchor candle index.
      let anchorIdx = 0;
      if (!last) {
        anchorIdx = -1;
      } else if (mode === 5) {
        anchorIdx = 0;
      } else if (mode === 0) {
        anchorIdx = Math.max(0, candles.length - Math.max(1, num(p, "barsBack", 50)));
      } else if (mode === 6) {
        const at = num(p, "anchorTime", 0);
        anchorIdx = at > 0 ? candles.findIndex((c) => c.time >= at) : 0;
        if (anchorIdx < 0) anchorIdx = candles.length - 1;
      } else {
        const dt = new Date(last.time * 1000);
        let boundary: number;
        if (mode === 1) {
          boundary = Math.floor(last.time / 86400) * 86400;
        } else if (mode === 2) {
          const day = Math.floor(last.time / 86400);
          boundary = (day - ((day + 4) % 7)) * 86400; // Monday 00:00 UTC
        } else if (mode === 3) {
          boundary = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) / 1000;
        } else {
          boundary = Date.UTC(dt.getUTCFullYear(), 0, 1) / 1000;
        }
        anchorIdx = candles.findIndex((c) => c.time >= boundary);
        if (anchorIdx < 0) anchorIdx = candles.length - 1;
      }

      const vals: (number | null)[] = new Array(candles.length).fill(null);
      let pv = 0;
      let vol = 0;
      for (let i = anchorIdx; i >= 0 && i < candles.length; i++) {
        const c = candles[i];
        const v = c.volume ?? 1;
        pv += src(c, p.source as Source) * v;
        vol += v;
        vals[i] = vol > 0 ? pv / vol : null;
      }
      return { series: [toSeries("avwap", "AVWAP", col, candles, vals)] };
    },
  },
  {
    id: "supertrend",
    name: "ST — Supertrend",
    params: [
      { key: "length", label: "ATR Length", type: "number", default: 10, min: 1, max: 200, step: 1 },
      { key: "mult", label: "Multiplier", type: "number", default: 3, min: 0.1, max: 20, step: 0.1 },
      colorParam("upColor", "Up", "#22c55e"),
      colorParam("downColor", "Down", "#ef4444"),
    ],
    compute(candles, p) {
      const len = num(p, "length", 10);
      const mult = num(p, "mult", 3);
      const atr = ema(tr(candles), len);
      const up: (number | null)[] = new Array(candles.length).fill(null);
      const down: (number | null)[] = new Array(candles.length).fill(null);
      let fUpper = 0;
      let fLower = 0;
      let trend: 1 | -1 = -1;
      for (let i = 0; i < candles.length; i++) {
        const a = atr[i];
        if (a == null) continue;
        const hl2 = (candles[i].high + candles[i].low) / 2;
        const ub = hl2 + mult * a;
        const lb = hl2 - mult * a;
        const prevClose = candles[i - 1]?.close ?? candles[i].open;
        fUpper = ub < fUpper || prevClose > fUpper ? ub : fUpper;
        fLower = lb > fLower || prevClose < fLower ? lb : fLower;
        if (candles[i].close > fUpper) trend = 1;
        else if (candles[i].close < fLower) trend = -1;
        if (trend === 1) up[i] = fLower;
        else down[i] = fUpper;
      }
      return {
        series: [
          toSeries("up", "ST Up", color(p, "upColor", "#22c55e"), candles, up),
          toSeries("down", "ST Down", color(p, "downColor", "#ef4444"), candles, down),
        ],
      };
    },
  },
];
