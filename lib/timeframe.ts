/** Supported chart timeframes and per-provider interval mappings. */

import type { Candle } from "@/lib/types";

export const TIMEFRAMES = [
  "1m",
  "5m",
  "15m",
  "30m",
  "45m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "16h",
  "1d",
  "2D",
  "W",
  "M",
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Candle duration in seconds, used for client-side candle bucketing. */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "45m": 2700,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "6h": 21600,
  "8h": 28800,
  "12h": 43200,
  "16h": 57600,
  "1d": 86400,
  "2D": 172800,
  "W": 604800,
  "M": 2592000,
};

export const BASE_TIMEFRAME: Record<Timeframe, Timeframe> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "15m",
  "45m": "15m",
  "1h": "1h",
  "2h": "1h",
  "4h": "4h",
  "6h": "1h",
  "8h": "4h",
  "12h": "4h",
  "16h": "4h",
  "1d": "1d",
  "2D": "1d",
  "W": "1d",
  "M": "1d",
};

/** Floor a unix-second timestamp to the start of its candle bucket. */
export function bucketStart(unixSeconds: number, tf: Timeframe): number {
  if (tf === "M") {
    const date = new Date(unixSeconds * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  }
  if (tf === "W") {
    const date = new Date(unixSeconds * 1000);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    return Math.floor(date.getTime() / 1000);
  }
  const size = TIMEFRAME_SECONDS[tf];
  return Math.floor(unixSeconds / size) * size;
}

export function aggregateCandles(candles: readonly Candle[], tf: Timeframe): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const candle of [...candles].sort((a, b) => a.time - b.time)) {
    const time = bucketStart(candle.time, tf);
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, { ...candle, time });
      continue;
    }
    buckets.set(time, {
      time,
      open: current.open,
      high: Math.max(current.high, candle.high),
      low: Math.min(current.low, candle.low),
      close: candle.close,
      ...(current.volume === undefined && candle.volume === undefined
        ? {}
        : { volume: (current.volume ?? 0) + (candle.volume ?? 0) }),
    });
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
