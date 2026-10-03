import type { Candle } from "@/lib/types";
import type { SymbolOption } from "@/lib/symbols";
import type { Timeframe } from "@/lib/timeframe";
import { hyperliquidSource } from "@/lib/sources/hyperliquid";
import { alpacaSource } from "@/lib/sources/alpaca";
import { topstepSource } from "@/lib/sources/topstep";

/**
 * Pluggable market-data source.
 *
 * To add a broker (Alpaca, Binance, Zerodha, Polygon, ...): implement this
 * interface in a new file under lib/sources/, then register it in
 * DATA_SOURCES below and add its symbols to lib/symbols.ts.
 */
export interface DataSource {
  id: string;
  label: string;
  symbols: SymbolOption[];
  timeframes: readonly Timeframe[];
  /** Historical candles, oldest first, `time` in unix seconds. */
  fetchHistory: (symbol: string, tf: Timeframe) => Promise<Candle[]>;
  /** Live updates; returns an unsubscribe function. */
  subscribe: (symbol: string, tf: Timeframe, onCandle: (c: Candle) => void) => () => void;
}

export const DATA_SOURCES: Record<string, DataSource> = {
  hyperliquid: hyperliquidSource,
  alpaca: alpacaSource,
  futures: topstepSource,
};

export function getDataSource(id: string): DataSource {
  const src = DATA_SOURCES[id];
  if (!src) throw new Error(`Unknown data source: ${id}`);
  return src;
}
