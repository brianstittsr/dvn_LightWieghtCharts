/** A single OHLC candle. `time` is a UNIX timestamp in seconds. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Latest traded price for a symbol. */
export interface Quote {
  symbol: string;
  price: number;
  time: number;
}

/** Unified candle tick emitted by a data source subscription. */
export type CandleTick = Candle;
