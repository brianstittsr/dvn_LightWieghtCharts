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
  "1d": { unit: PX_BAR_UNIT.Day, unitNumber: 1 },
};

/** "BTC" → "BTC/USD" for Alpaca crypto symbols (already-formatted pass through). */
export function alpacaCryptoSymbol(symbol: string): string {
  return symbol.includes("/") ? symbol : `${symbol}/USD`;
}

async function alpacaBars(
  symbol: string,
  tf: string,
  limit: number,
  keys?: AlpacaKeys,
): Promise<Candle[]> {
  const res = await alpacaData<{ bars?: RawBar[] }>(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${ALPACA_TF[tf] ?? "5Min"}&limit=${limit}`,
    undefined,
    keys,
  );
  return (res.bars ?? []).map((b) => ({
    time: Math.floor(new Date(b.t).getTime() / 1000),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

async function alpacaCryptoBars(
  symbol: string,
  tf: string,
  limit: number,
  keys?: AlpacaKeys,
): Promise<Candle[]> {
  const res = await alpacaDataRaw<{ bars?: Record<string, RawBar[]> }>(
    `/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(alpacaCryptoSymbol(symbol))}&timeframe=${ALPACA_TF[tf] ?? "5Min"}&limit=${limit}`,
    keys,
  ).catch(() => ({}) as { bars?: Record<string, RawBar[]> });
  const bars = res.bars?.[alpacaCryptoSymbol(symbol)];
  // Fall back to Hyperliquid when Alpaca crypto bars aren't entitled.
  if (!bars?.length) return hlBars(symbol, tf, limit);
  return bars.map((b) => ({
    time: Math.floor(new Date(b.t).getTime() / 1000),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

async function hlBars(symbol: string, tf: string, limit: number): Promise<Candle[]> {
  const rows = await hlCandles(symbol, HL_TF[tf] ?? "5m", limit);
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
): Promise<Candle[]> {
  const resolved = await userCredsFor("topstep", uid);
  if (!resolved) throw new Error("No TopStep credentials for futures bars");
  const key = root.toUpperCase();
  let contractId = frontCache.get(key);
  if (!contractId) {
    contractId = (await resolveFrontContract(resolved.creds, key)).id;
    frontCache.set(key, contractId);
  }
  const px = PX_TF[tf] ?? PX_TF["5m"];
  const secs = tf === "1d" ? 86400 : tf === "1h" ? 3600 : tf === "15m" ? 900 : tf === "5m" ? 300 : 60;
  const bars = await projectxBars(
    resolved.creds,
    contractId,
    px.unit,
    px.unitNumber,
    secs * (limit + 10) * 1000,
    limit,
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
  if (assetClass === "stock") return alpacaBars(sym, tf, limit, keys);
  if (assetClass === "crypto") return alpacaCryptoBars(sym, tf, limit, keys);
  return futuresBars(uid, sym, tf, limit);
}
