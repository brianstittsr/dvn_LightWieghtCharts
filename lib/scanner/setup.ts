/**
 * Setup scanner (the article's "Scanner B") — flags which tickers in a
 * universe meet a day-trading entry setup *right now*.
 *
 * Built-in "Trend Join Long": daily breakout (price > prev daily high AND
 * prev close > SMA200) plus intraday breakout (price > premarket high AND
 * > today's high-of-day). Custom saved strategies evaluate via the same
 * desiredFromCode sandbox as backtests/bots — latest non-flat = hit.
 */
import { alpacaData } from "@/lib/alpaca";
import { desiredFromCode } from "@/lib/backtest";
import { barsFor } from "@/lib/scanner/data";
import { etDateKey, etNow, etToUtc } from "@/lib/scanner/types";
import type { AssetClass, SetupResult } from "@/lib/scanner/types";
import type { Candle } from "@/lib/types";

export interface SetupStrategy {
  /** "trend-join-long" for the builtin, anything else = custom code. */
  id: string;
  code?: string;
  params?: Record<string, number>;
}

interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

async function dailyBars(symbol: string): Promise<Bar[]> {
  const res = await alpacaData<{ bars?: Bar[] }>(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&limit=210`,
  );
  return res.bars ?? [];
}

async function todayMinuteBars(symbol: string): Promise<Bar[]> {
  const { dateKey } = etNow();
  const start = etToUtc(dateKey, 4, 0).toISOString();
  const res = await alpacaData<{ bars?: Bar[] }>(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Min&start=${encodeURIComponent(start)}&limit=800`,
  );
  return res.bars ?? [];
}

/** One batched latest-trade call for the whole universe. */
async function latestPrices(symbols: string[]): Promise<Record<string, number>> {
  try {
    const res = await alpacaData<Record<string, { p: number }>>(
      `/v2/stocks/trades/latest?symbols=${symbols.join(",")}`,
    );
    return Object.fromEntries(
      Object.entries(res).map(([s, t]) => [s, t.p]),
    );
  } catch {
    return {};
  }
}

/** Article's Trend Join Long criteria, computed per ticker. */
async function evalTjl(symbol: string, currPx: number): Promise<SetupResult> {
  const { dateKey } = etNow();
  const [daily, minute] = await Promise.all([
    dailyBars(symbol),
    todayMinuteBars(symbol),
  ]);

  const completed = daily.filter((b) => etDateKey(new Date(b.t)) < dateKey);
  const prev = completed.at(-1);
  const sma200 =
    completed.length >= 200
      ? completed.slice(-200).reduce((s, b) => s + b.c, 0) / 200
      : undefined;
  if (!prev || sma200 === undefined) {
    return { symbol, result: "error", reason: "insufficient daily history" };
  }

  const open = etToUtc(dateKey, 9, 30);
  const pmh = Math.max(
    ...minute.filter((b) => new Date(b.t) < open).map((b) => b.h),
    0,
  );
  const todayHod = Math.max(
    ...minute.filter((b) => new Date(b.t) >= open).map((b) => b.h),
    0,
  );

  const dailyOk = currPx > prev.h && prev.c > sma200;
  const intradayOk = pmh > 0 && currPx > pmh && currPx > todayHod;
  return {
    symbol,
    result: dailyOk && intradayOk ? "PASS" : dailyOk ? "fail_intraday" : "fail_daily",
    currPrice: currPx,
    prevDailyHigh: prev.h,
    prevDailyClose: prev.c,
    sma200,
    pmh: pmh || undefined,
    todayHod: todayHod || undefined,
  };
}

/** Custom strategy: run desiredFromCode on recent candles of the asset. */
async function evalCustom(
  assetClass: AssetClass,
  symbol: string,
  code: string,
  params: Record<string, number>,
  uid: string | null,
): Promise<SetupResult> {
  const candles: Candle[] =
    assetClass === "stock"
      ? (await todayMinuteBars(symbol)).map((b) => ({
          time: Math.floor(new Date(b.t).getTime() / 1000),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        }))
      : await barsFor(assetClass, symbol, "5m", 300, uid);
  if (candles.length === 0) {
    return { symbol, result: "error", reason: "no bars for this symbol" };
  }
  const desired = desiredFromCode(code, candles, params);
  const last = desired.at(-1) ?? "flat";
  return {
    symbol,
    result: last === "flat" ? "fail_intraday" : "PASS",
    reason: last === "flat" ? undefined : `signal: ${last}`,
    currPrice: candles.at(-1)?.close,
  };
}

/**
 * Scan a universe sequentially-in-batches (Alpaca rate limits).
 * `currPx` falls back to the last daily close when a latest trade is missing.
 */
export async function runSetupScan(
  universe: string[],
  strategy: SetupStrategy,
  opts: { assetClass?: AssetClass; uid?: string | null } = {},
): Promise<SetupResult[]> {
  const assetClass = opts.assetClass ?? "stock";
  const uid = opts.uid ?? null;
  const prices = assetClass === "stock" ? await latestPrices(universe) : {};
  const results: SetupResult[] = [];
  const BATCH = 4;
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = await Promise.all(
      universe.slice(i, i + BATCH).map(async (symbol): Promise<SetupResult> => {
        try {
          if (strategy.id === "trend-join-long") {
            if (assetClass !== "stock") {
              return { symbol, result: "error", reason: "TJL is stocks-only" };
            }
            const px =
              prices[symbol] ??
              (await dailyBars(symbol).then((b) => b.at(-1)?.c ?? 0));
            if (!px) return { symbol, result: "error", reason: "no price" };
            return await evalTjl(symbol, px);
          }
          if (!strategy.code) {
            return { symbol, result: "error", reason: "strategy has no code" };
          }
          return await evalCustom(
            assetClass,
            symbol,
            strategy.code,
            strategy.params ?? {},
            uid,
          );
        } catch (err) {
          return {
            symbol,
            result: "error",
            reason: err instanceof Error ? err.message : "eval failed",
          };
        }
      }),
    );
    results.push(...batch);
  }
  return results;
}
