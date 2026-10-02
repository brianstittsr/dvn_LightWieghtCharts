import type { Candle } from "@/lib/types";
import type { IndicatorDef } from "./types";
import { color, colorParam, ema, lengthParam, num, rma, sma, sourceParam, src, toSeries, tr, type Source } from "./math";

/** Oscillators render in their own sub-pane (pane index 1), not over price. */
const PANE = { pane: 1 };

function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

function rsi(candles: Candle[], len: number): (number | null)[] {
  const cs = closes(candles);
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < cs.length; i++) {
    const ch = cs[i] - cs[i - 1];
    gains.push(Math.max(ch, 0));
    losses.push(Math.max(-ch, 0));
  }
  const ag = rma(gains, len);
  const al = rma(losses, len);
  return cs.map((_, i) => {
    if (ag[i] == null || al[i] == null) return null;
    if (al[i] === 0) return 100;
    return 100 - 100 / (1 + ag[i]! / al[i]!);
  });
}

export const OSCILLATOR_INDICATORS: IndicatorDef[] = [
  {
    id: "rsi",
    name: "RSI — Relative Strength Index",
    ...PANE,
    params: [lengthParam(14), colorParam("color", "Color", "#a855f7")],
    compute(candles, p) {
      return { series: [toSeries("rsi", "RSI", color(p, "color", "#a855f7"), candles, rsi(candles, num(p, "length", 14)))] };
    },
  },
  {
    id: "macd",
    name: "MACD",
    ...PANE,
    params: [
      { key: "fast", label: "Fast", type: "number", default: 12, min: 1, max: 200, step: 1 },
      { key: "slow", label: "Slow", type: "number", default: 26, min: 1, max: 200, step: 1 },
      { key: "signal", label: "Signal", type: "number", default: 9, min: 1, max: 200, step: 1 },
      colorParam("macdColor", "MACD", "#3b82f6"),
      colorParam("signalColor", "Signal", "#f97316"),
    ],
    compute(candles, p) {
      const fast = ema(closes(candles), num(p, "fast", 12));
      const slow = ema(closes(candles), num(p, "slow", 26));
      const macdLine = fast.map((f, i) => (f == null || slow[i] == null ? null : f - slow[i]!));
      const defined = macdLine.map((v) => v ?? 0);
      const sig = ema(defined, num(p, "signal", 9));
      const hist = macdLine.map((m, i) => (m == null || sig[i] == null ? null : m - sig[i]!));
      return {
        series: [
          toSeries("macd", "MACD", color(p, "macdColor", "#3b82f6"), candles, macdLine),
          toSeries("signal", "Signal", color(p, "signalColor", "#f97316"), candles, sig.map((s, i) => (macdLine[i] == null ? null : s))),
          toSeries("hist", "Hist", "#6b7280", candles, hist),
        ],
      };
    },
  },
  {
    id: "stoch",
    name: "Stochastic",
    ...PANE,
    params: [
      { key: "k", label: "%K", type: "number", default: 14, min: 1, max: 200, step: 1 },
      { key: "d", label: "%D", type: "number", default: 3, min: 1, max: 200, step: 1 },
      colorParam("kColor", "%K", "#22d3ee"),
      colorParam("dColor", "%D", "#f97316"),
    ],
    compute(candles, p) {
      const kLen = num(p, "k", 14);
      const kVals: (number | null)[] = candles.map((c, i) => {
        if (i + 1 < kLen) return null;
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i + 1 - kLen; j <= i; j++) {
          hh = Math.max(hh, candles[j].high);
          ll = Math.min(ll, candles[j].low);
        }
        return hh === ll ? 50 : ((c.close - ll) / (hh - ll)) * 100;
      });
      const dVals = sma(kVals.map((v) => v ?? 0), num(p, "d", 3)).map((v, i) => (kVals[i] == null ? null : v));
      return {
        series: [
          toSeries("k", "%K", color(p, "kColor", "#22d3ee"), candles, kVals),
          toSeries("d", "%D", color(p, "dColor", "#f97316"), candles, dVals),
        ],
      };
    },
  },
  {
    id: "atr",
    name: "ATR — Average True Range",
    ...PANE,
    params: [lengthParam(14), colorParam("color", "Color", "#eab308")],
    compute(candles, p) {
      return { series: [toSeries("atr", "ATR", color(p, "color", "#eab308"), candles, rma(tr(candles), num(p, "length", 14)))] };
    },
  },
  {
    id: "adx",
    name: "ADX — Average Directional Index",
    ...PANE,
    params: [
      lengthParam(14),
      colorParam("adxColor", "ADX", "#eab308"),
      colorParam("diPlusColor", "+DI", "#22c55e"),
      colorParam("diMinusColor", "-DI", "#ef4444"),
    ],
    compute(candles, p) {
      const len = num(p, "length", 14);
      const n = candles.length;
      const plusDM: number[] = [0];
      const minusDM: number[] = [0];
      const trs = tr(candles);
      for (let i = 1; i < n; i++) {
        const up = candles[i].high - candles[i - 1].high;
        const dn = candles[i - 1].low - candles[i].low;
        plusDM.push(up > dn && up > 0 ? up : 0);
        minusDM.push(dn > up && dn > 0 ? dn : 0);
      }
      const str = rma(trs, len);
      const sP = rma(plusDM, len);
      const sM = rma(minusDM, len);
      const diP = sP.map((v, i) => (v == null || !str[i] ? null : (100 * v) / str[i]!));
      const diM = sM.map((v, i) => (v == null || !str[i] ? null : (100 * v) / str[i]!));
      const dx = diP.map((p_, i) =>
        p_ == null || diM[i] == null || p_ + diM[i]! === 0 ? 0 : (100 * Math.abs(p_ - diM[i]!)) / (p_ + diM[i]!),
      );
      const adxVals = rma(dx, len).map((v, i) => (diP[i] == null ? null : v));
      return {
        series: [
          toSeries("adx", "ADX", color(p, "adxColor", "#eab308"), candles, adxVals),
          toSeries("diPlus", "+DI", color(p, "diPlusColor", "#22c55e"), candles, diP),
          toSeries("diMinus", "-DI", color(p, "diMinusColor", "#ef4444"), candles, diM),
        ],
      };
    },
  },
  {
    id: "cci",
    name: "CCI — Commodity Channel Index",
    ...PANE,
    params: [lengthParam(20), colorParam("color", "Color", "#38bdf8")],
    compute(candles, p) {
      const len = num(p, "length", 20);
      const tps = candles.map((c) => (c.high + c.low + c.close) / 3);
      const mean = sma(tps, len);
      const vals = tps.map((tp, i) => {
        if (i + 1 < len || mean[i] == null) return null;
        let md = 0;
        for (let j = i + 1 - len; j <= i; j++) md += Math.abs(tps[j] - mean[i]!);
        md /= len;
        return md === 0 ? 0 : (tp - mean[i]!) / (0.015 * md);
      });
      return { series: [toSeries("cci", "CCI", color(p, "color", "#38bdf8"), candles, vals)] };
    },
  },
  {
    id: "willr",
    name: "Williams %R",
    ...PANE,
    params: [lengthParam(14), colorParam("color", "Color", "#e879f9")],
    compute(candles, p) {
      const len = num(p, "length", 14);
      const vals = candles.map((c, i) => {
        if (i + 1 < len) return null;
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i + 1 - len; j <= i; j++) {
          hh = Math.max(hh, candles[j].high);
          ll = Math.min(ll, candles[j].low);
        }
        return hh === ll ? -50 : ((hh - c.close) / (hh - ll)) * -100;
      });
      return { series: [toSeries("willr", "W%R", color(p, "color", "#e879f9"), candles, vals)] };
    },
  },
  {
    id: "mfi",
    name: "MFI — Money Flow Index",
    ...PANE,
    params: [lengthParam(14), colorParam("color", "Color", "#34d399")],
    compute(candles, p) {
      const len = num(p, "length", 14);
      const tps = candles.map((c) => (c.high + c.low + c.close) / 3);
      const vals = tps.map((tp, i) => {
        if (i < len) return null;
        let pos = 0;
        let neg = 0;
        for (let j = i - len + 1; j <= i; j++) {
          const mf = tps[j] * (candles[j].volume ?? 0);
          if (tps[j] > tps[j - 1]) pos += mf;
          else if (tps[j] < tps[j - 1]) neg += mf;
        }
        return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
      });
      return { series: [toSeries("mfi", "MFI", color(p, "color", "#34d399"), candles, vals)] };
    },
  },
  {
    id: "obv",
    name: "OBV — On-Balance Volume",
    ...PANE,
    params: [colorParam("color", "Color", "#fbbf24")],
    compute(candles, p) {
      let acc = 0;
      const vals = candles.map((c, i) => {
        if (i > 0) {
          const v = c.volume ?? 0;
          if (c.close > candles[i - 1].close) acc += v;
          else if (c.close < candles[i - 1].close) acc -= v;
        }
        return acc;
      });
      return { series: [toSeries("obv", "OBV", color(p, "color", "#fbbf24"), candles, vals)] };
    },
  },
  {
    id: "roc",
    name: "ROC — Rate of Change",
    ...PANE,
    params: [lengthParam(12), sourceParam(), colorParam("color", "Color", "#f472b6")],
    compute(candles, p) {
      const len = num(p, "length", 12);
      const vals = candles.map((c) => src(c, p.source as Source));
      const out = vals.map((v, i) => (i < len || vals[i - len] === 0 ? null : ((v - vals[i - len]) / vals[i - len]) * 100));
      return { series: [toSeries("roc", "ROC", color(p, "color", "#f472b6"), candles, out)] };
    },
  },
];
