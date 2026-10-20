/**
 * Unified bar source for scanners + Alpaca bots — fetch candles for any
 * supported asset class through one signature.
 */
import { alpacaData, alpacaDataRaw, type AlpacaKeys } from "@/lib/alpaca";
import { hlCandles } from "@/lib/platforms/hyperliquid";
import {
  projectxBars,
  resolveFrontContract,
  userCredsFor,
  PX_BAR_UNIT,
} from "@/lib/platforms/projectx";
import type { Candle } from "@/lib/types";
import type { AssetClass } from "@/lib/scanner/types";
import {
  aggregateCandles,
  BASE_TIMEFRAME,
  TIMEFRAME_SECONDS,
  type Timeframe,
} from "@/lib/timeframe";

interface RawBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const ALPACA_TF: Record<string, string> = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1h": "1Hour",
  "4h": "4Hour",
  "1d": "1Day",
};

const HL_TF: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const PX_TF: Record<string, { unit: number; unitNumber: number }> = {
  "1m": { unit: PX_BAR_UNIT.Minute, unitNumber: 1 },
  "5m": { unit: PX_BAR_UNIT.Minute, unitNumber: 5 },
  "15m": { unit: PX_BAR_UNIT.Minute, unitNumber: 15 },
  "1h": { unit: PX_BAR_UNIT.Hour, unitNumber: 1 },
  "4h": { unit: PX_BAR_UNIT.Hour, unitNumber: 4 },
  "1d": { unit: PX_BAR_UNIT.Day, unitNumber: 1 },
};

/** "BTC" → "BTC/USD" for Alpaca crypto symbols (already-formatted pass through). */
export function alpacaCryptoSymbol(symbol: string): string {
  return symbol.includes("/") ? symbol : `${symbol}/USD`;
}

const toCandle = (b: RawBar): Candle => ({
  time: Math.floor(new Date(b.t).getTime() / 1000),
  open: b.o,
  high: b.h,
  low: b.l,
  close: b.c,
  volume: b.v,
});

/** Alpaca bars over an explicit range, following pagination up to `cap`. */
async function alpacaBarsRange(
  path: (pageToken?: string) => string,
  pick: (res: unknown) => RawBar[] | undefined,
  cap: number,
  keys?: AlpacaKeys,
  raw = false,
): Promise<Candle[]> {
  const out: Candle[] = [];
  let pageToken: string | undefined;
  do {
    const res = raw
      ? await alpacaDataRaw<{ bars?: unknown; next_page_token?: string }>(path(pageToken), keys)
      : await alpacaData<{ bars?: unknown; next_page_token?: string }>(path(pageToken), undefined, keys);
    const page = pick(res) ?? [];
    for (const b of page) out.push(toCandle(b));
    pageToken = res.next_page_token ?? undefined;
  } while (pageToken && out.length < cap);
  return out.slice(0, cap).sort((a, b) => a.time - b.time);
}

async function alpacaBars(
  symbol: string,
  tf: string,
  limit: number,
  keys?: AlpacaKeys,
  range?: { fromSec: number; toSec: number },
): Promise<Candle[]> {
  const baseTf = BASE_TIMEFRAME[tf as Timeframe] ?? "5m";
  if (range) {
    const start = new Date(range.fromSec * 1000).toISOString();
    const end = new Date(range.toSec * 1000).toISOString();
    return alpacaBarsRange(
      (pt) =>
        `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${ALPACA_TF[baseTf] ?? "5Min"}&start=${start}&end=${end}&limit=10000${pt ? `&page_token=${pt}` : ""}`,
      (res) => (res as { bars?: RawBar[] }).bars,
      10000,
      keys,
    );
  }
  const res = await alpacaData<{ bars?: RawBar[] }>(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${ALPACA_TF[baseTf] ?? "5Min"}&limit=${limit}`,
    undefined,
    keys,
  );
  return (res.bars ?? []).map(toCandle);
}

async function alpacaCryptoBars(
  symbol: string,
  tf: string,
  limit: number,
  keys?: AlpacaKeys,
  range?: { fromSec: number; toSec: number },
): Promise<Candle[]> {
  const baseTf = BASE_TIMEFRAME[tf as Timeframe] ?? "5m";
  if (range) {
    const start = new Date(range.fromSec * 1000).toISOString();
    const end = new Date(range.toSec * 1000).toISOString();
    const sym = alpacaCryptoSymbol(symbol);
    const candles = await alpacaBarsRange(
      (pt) =>
        `/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(sym)}&timeframe=${ALPACA_TF[baseTf] ?? "5Min"}&start=${start}&end=${end}&limit=10000${pt ? `&page_token=${pt}` : ""}`,
      (res) => (res as { bars?: Record<string, RawBar[]> }).bars?.[sym],
      10000,
      keys,
      true,
    ).catch(() => [] as Candle[]);
    if (candles.length) return candles;
    return hlBars(symbol, baseTf, limit, range);
  }
  const res = await alpacaDataRaw<{ bars?: Record<string, RawBar[]> }>(
    `/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(alpacaCryptoSymbol(symbol))}&timeframe=${ALPACA_TF[baseTf] ?? "5Min"}&limit=${limit}`,
    keys,
  ).catch(() => ({}) as { bars?: Record<string, RawBar[]> });
  const bars = res.bars?.[alpacaCryptoSymbol(symbol)];
  // Fall back to Hyperliquid when Alpaca crypto bars aren't entitled.
  if (!bars?.length) return hlBars(symbol, baseTf, limit);
  return bars.map(toCandle);
}

async function hlBars(
  symbol: string,
  tf: string,
  limit: number,
  range?: { fromSec: number; toSec: number },
): Promise<Candle[]> {
  const rows = await hlCandles(
    symbol,
    HL_TF[tf] ?? "5m",
    range ? 5000 : limit,
    range ? { startMs: range.fromSec * 1000, endMs: range.toSec * 1000 } : undefined,
  );
  return rows.map((r) => ({
    time: Math.floor(r.t / 1000),
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
    volume: Number(r.v),
  }));
}

const frontCache = new Map<string, string>();

async function futuresBars(
  uid: string | null,
  root: string,
  tf: string,
  limit: number,
  range?: { fromSec: number; toSec: number },
): Promise<Candle[]> {
  const baseTf = BASE_TIMEFRAME[tf as Timeframe] ?? "5m";
  const resolved = await userCredsFor("topstep", uid);
  if (!resolved) throw new Error("No TopStep credentials for futures bars");
  const key = root.toUpperCase();
  let contractId = frontCache.get(key);
  if (!contractId) {
    contractId = (await resolveFrontContract(resolved.creds, key)).id;
    frontCache.set(key, contractId);
  }
  const px = PX_TF[baseTf] ?? PX_TF["5m"];
  const secs = baseTf === "1d" ? 86400 : baseTf === "4h" ? 14400 : baseTf === "1h" ? 3600 : baseTf === "15m" ? 900 : baseTf === "5m" ? 300 : 60;
  const bars = await projectxBars(
    resolved.creds,
    contractId,
    px.unit,
    px.unitNumber,
    secs * (limit + 10) * 1000,
    range ? 5000 : limit,
    range ? { startMs: range.fromSec * 1000, endMs: range.toSec * 1000 } : undefined,
  );
  return bars.map((b) => ({
    time: Math.floor(new Date(b.t).getTime() / 1000),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

/**
 * Candles for a symbol in an asset class.
 * Futures roots resolve to front-month via the caller's TopStep creds.
 */
export async function barsFor(
  assetClass: AssetClass,
  symbol: string,
  tf: string,
  limit = 300,
  uid: string | null = null,
  keys?: AlpacaKeys,
): Promise<Candle[]> {
  const sym = symbol.toUpperCase();
  const timeframe = tf as Timeframe;
  const baseTf = BASE_TIMEFRAME[timeframe] ?? "5m";
  const baseLimit = Math.min(
    10_000,
    Math.ceil(limit * ((TIMEFRAME_SECONDS[timeframe] ?? 300) / TIMEFRAME_SECONDS[baseTf])) + 10,
  );
  const candles = assetClass === "stock"
    ? await alpacaBars(sym, baseTf, baseLimit, keys)
    : assetClass === "crypto"
      ? await alpacaCryptoBars(sym, baseTf, baseLimit, keys)
      : await futuresBars(uid, sym, baseTf, baseLimit);
  const aggregated = aggregateCandles(candles, timeframe);
  return limit > 0 ? aggregated.slice(-limit) : aggregated;
}

/**
 * Candles over an explicit [fromSec, toSec) range — for the optimizer's
 * user-defined backtest periods. Same venue routing as `barsFor`.
 */
export async function barsRangeFor(
  assetClass: AssetClass,
  symbol: string,
  tf: string,
  fromSec: number,
  toSec: number,
  uid: string | null = null,
  keys?: AlpacaKeys,
): Promise<Candle[]> {
  const sym = symbol.toUpperCase();
  const range = { fromSec, toSec };
  const timeframe = tf as Timeframe;
  const baseTf = BASE_TIMEFRAME[timeframe] ?? "5m";
  const candles = assetClass === "stock"
    ? await alpacaBars(sym, baseTf, 0, keys, range)
    : assetClass === "crypto"
      ? await alpacaCryptoBars(sym, baseTf, 0, keys, range)
      : await futuresBars(uid, sym, baseTf, 0, range);
  return aggregateCandles(candles, timeframe);
}
