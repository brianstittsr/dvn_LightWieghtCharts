import type { Candle } from "@/lib/types";
import type { IndicatorBox, IndicatorDef, IndicatorLevel, IndicatorSeries } from "./types";

/**
 * Session high/low markers (Asia / London) for sweep-and-reversal setups.
 * Levels build tick-by-tick during the session window, then hold until the
 * next session starts — matching how TradingView session-range tools draw.
 */

interface SessionOpts {
  id: string;
  name: string;
  defaultStart: number; // local hour
  defaultEnd: number; // local hour (may be < start → overnight session)
  highColor: string;
  lowColor: string;
}

const HOUR = 3600;

/** Current UTC offset of America/New_York (-4 EDT, -5 EST), auto-detected. */
function newYorkUtcOffset(): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = tz.match(/GMT([+-]?\d+)/);
    return m ? Number(m[1]) : -5;
  } catch {
    return -5;
  }
}

const NY_OFFSET = newYorkUtcOffset();

/** Local date string (in the indicator's tz) a candle belongs to. */
function localDay(t: number, tzOffsetH: number): number {
  return Math.floor((t + tzOffsetH * HOUR) / 86400);
}

/** Hour-of-day in the indicator's tz. */
function localHour(t: number, tzOffsetH: number): number {
  return ((t + tzOffsetH * HOUR) / HOUR) % 24;
}

/**
 * The session "key" (start day) a candle belongs to, or null if outside the
 * session window. Handles overnight sessions (start > end).
 */
function sessionKey(t: number, tz: number, startH: number, endH: number): number | null {
  const h = localHour(t, tz);
  const day = localDay(t, tz);
  if (startH <= endH) {
    return h >= startH && h < endH ? day : null;
  }
  // Overnight: hours >= startH belong to today's session; hours < endH to yesterday's.
  if (h >= startH) return day;
  if (h < endH) return day - 1;
  return null;
}

function makeSessionIndicator(o: SessionOpts): IndicatorDef {
  return {
    id: o.id,
    name: o.name,
    params: [
      { key: "startHour", label: "Start hour", type: "number", default: o.defaultStart, min: 0, max: 23, step: 1 },
      { key: "endHour", label: "End hour", type: "number", default: o.defaultEnd, min: 0, max: 23, step: 1 },
      { key: "offset", label: "UTC offset", type: "number", default: NY_OFFSET, min: -12, max: 14, step: 1 },
      { key: "extendHour", label: "Extend until (hour)", type: "number", default: 17, min: 0, max: 23, step: 1 },
      { key: "highColor", label: "High", type: "color", default: o.highColor },
      { key: "lowColor", label: "Low", type: "color", default: o.lowColor },
      { key: "alert", label: "Reversal alerts", type: "boolean", default: 1 },
      { key: "near", label: "Approach alert %", type: "number", default: 0.15, min: 0.01, max: 5, step: 0.01 },
    ],
    compute(candles: Candle[], p) {
      const startH = Number(p.startHour ?? o.defaultStart);
      const endH = Number(p.endHour ?? o.defaultEnd);
      const tz = Number(p.offset ?? NY_OFFSET);
      const extendH = Number(p.extendHour ?? 21);
      const highColor = String(p.highColor ?? o.highColor);
      const lowColor = String(p.lowColor ?? o.lowColor);

      // Pass 1: final high/low per session day.
      const ranges = new Map<number, { high: number; low: number }>();
      for (const c of candles) {
        const key = sessionKey(c.time, tz, startH, endH);
        if (key == null) continue;
        const r = ranges.get(key) ?? { high: -Infinity, low: Infinity };
        r.high = Math.max(r.high, c.high);
        r.low = Math.min(r.low, c.low);
        ranges.set(key, r);
      }

      /**
       * Pass 2: flat lines. A session's levels draw from its start hour until
       * `extendH` (default = end of the NY PM session, ~17:00 ET / 21:00 UTC),
       * then stop until the next session begins.
       */
      const inWindow = (t: number, key: number): boolean => {
        const h = localHour(t, tz);
        const day = localDay(t, tz);
        // Session window: same rule as sessionKey.
        if (sessionKey(t, tz, startH, endH) === key) return true;
        // Extension: candle is after the session, same day as `key`, before extendH.
        if (startH <= endH) {
          return day === key && h >= endH && h < extendH;
        }
        // Overnight session ending on `key + 1` morning.
        return day === key + 1 && h >= endH && h < extendH;
      };

      const highVals: { time: number; value: number | null }[] = [];
      const lowVals: { time: number; value: number | null }[] = [];
      for (const c of candles) {
        let r: { high: number; low: number } | undefined;
        for (const [key, range] of ranges) {
          if (inWindow(c.time, key)) {
            r = range;
            break;
          }
        }
        highVals.push({ time: c.time, value: r ? r.high : null });
        lowVals.push({ time: c.time, value: r ? r.low : null });
      }

      const series: IndicatorSeries[] = [
        { key: "high", label: `${o.name} High`, color: highColor, values: highVals },
        { key: "low", label: `${o.name} Low`, color: lowColor, values: lowVals },
      ];

      // Latest session whose range exists (for alerting).
      let lastKey: number | null = null;
      for (const c of candles) {
        const key = sessionKey(c.time, tz, startH, endH);
        if (key != null) lastKey = key;
      }
      const last = lastKey != null ? ranges.get(lastKey) : undefined;
      const levels: IndicatorLevel[] | undefined = last
        ? [
            { key: "high", label: `${o.name} high`, price: last.high, side: "above" },
            { key: "low", label: `${o.name} low`, price: last.low, side: "below" },
          ]
        : undefined;

      return { series, levels };
    },
  };
}

/**
 * Session definitions for the combined box indicator (ICT-style).
 * Hours are expressed in the indicator's configured timezone — New York
 * time by default, contiguous and non-overlapping (matches TradingView
 * session-box indicators): Asia 19:00–03:00, London 03:00–08:00,
 * New York 08:00–17:00.
 */
const BOX_SESSIONS = [
  { key: "asia", label: "ASIA", startH: 19, endH: 3, color: "#14b8a6" },
  { key: "london", label: "LONDON", startH: 3, endH: 8, color: "#3b82f6" },
  { key: "newyork", label: "NEW YORK", startH: 8, endH: 17, color: "#f59e0b" },
] as const;

/** Unix-second start of the session whose local start-day index is `key`. */
function sessionStartUnix(key: number, tz: number, startH: number): number {
  return key * 86400 + startH * HOUR - tz * HOUR;
}

const sessionBoxesIndicator: IndicatorDef = {
  id: "session-boxes",
  name: "Sessions — Asia / London / NY boxes",
  params: [
    { key: "offset", label: "UTC offset", type: "number", default: NY_OFFSET, min: -12, max: 14, step: 1 },
    { key: "alert", label: "Reversal alerts", type: "boolean", default: 1 },
    { key: "near", label: "Approach alert %", type: "number", default: 0.15, min: 0.01, max: 5, step: 0.01 },
  ],
  compute(candles: Candle[], p) {
    const tz = Number(p.offset ?? NY_OFFSET);
    const boxes: IndicatorBox[] = [];
    const latest: Record<string, { high: number; low: number } | undefined> = {};

    for (const s of BOX_SESSIONS) {
      const durH = ((s.endH - s.startH + 24) % 24) || 24;
      const ranges = new Map<number, { high: number; low: number }>();
      for (const c of candles) {
        const key = sessionKey(c.time, tz, s.startH, s.endH);
        if (key == null) continue;
        const r = ranges.get(key) ?? { high: -Infinity, low: Infinity };
        r.high = Math.max(r.high, c.high);
        r.low = Math.min(r.low, c.low);
        ranges.set(key, r);
      }
      for (const [key, r] of ranges) {
        const t1 = sessionStartUnix(key, tz, s.startH);
        boxes.push({ key: `${s.key}-${key}`, label: s.label, t1, t2: t1 + durH * HOUR, high: r.high, low: r.low, color: s.color });
        latest[s.key] = r;
      }
    }
    boxes.sort((a, b) => a.t1 - b.t1);

    const levels: IndicatorLevel[] = [];
    for (const s of BOX_SESSIONS) {
      const r = latest[s.key];
      if (!r) continue;
      levels.push(
        { key: `${s.key}-high`, label: `${s.label} high`, price: r.high, side: "above" },
        { key: `${s.key}-low`, label: `${s.label} low`, price: r.low, side: "below" },
      );
    }
    return { series: [], boxes, levels };
  },
};

export const SESSION_INDICATORS: IndicatorDef[] = [
  sessionBoxesIndicator,
  makeSessionIndicator({
    id: "asia-hl",
    name: "Asia Session High/Low",
    defaultStart: 19,
    defaultEnd: 4,
    highColor: "#f59e0b",
    lowColor: "#f59e0b",
  }),
  makeSessionIndicator({
    id: "london-hl",
    name: "London Session High/Low",
    defaultStart: 2,
    defaultEnd: 11,
    highColor: "#38bdf8",
    lowColor: "#38bdf8",
  }),
];
