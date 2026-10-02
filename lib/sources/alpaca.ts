import type { Candle, Quote } from "@/lib/types";
import type { DataSource } from "@/lib/data-sources";
import { STOCK_SYMBOLS } from "@/lib/symbols";
import { TIMEFRAMES, bucketStart, type Timeframe } from "@/lib/timeframe";

const POLL_MS = 10_000;

interface ApiOk<T> {
  data: T;
}
interface ApiErr {
  error: string;
}

async function api<T>(path: string, retries = 1): Promise<T> {
  const res = await fetch(path);
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!res.ok || !("data" in body)) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return api<T>(path, retries - 1);
    }
    throw new Error("error" in body ? body.error : `Request failed: ${res.status}`);
  }
  return body.data;
}

function fetchHistory(symbol: string, tf: Timeframe): Promise<Candle[]> {
  return api<Candle[]>(`/api/alpaca/bars?symbol=${encodeURIComponent(symbol)}&interval=${tf}`);
}

/** Latest-trade polls shared per symbol across panes. */
const quotePolls = new Map<string, { timer: ReturnType<typeof setInterval>; subs: Set<(q: Quote) => void> }>();

function subscribeQuote(symbol: string, cb: (q: Quote) => void): () => void {
  let entry = quotePolls.get(symbol);
  if (!entry) {
    const subs = new Set<(q: Quote) => void>();
    const timer = setInterval(async () => {
      try {
        const q = await api<Quote>(`/api/alpaca/quote?symbol=${encodeURIComponent(symbol)}`);
        subs.forEach((fn) => fn(q));
      } catch (err) {
        console.error(`Quote poll failed for ${symbol}:`, err);
      }
    }, POLL_MS);
    entry = { timer, subs };
    quotePolls.set(symbol, entry);
  }
  entry.subs.add(cb);
  return () => {
    const e = quotePolls.get(symbol);
    if (!e) return;
    e.subs.delete(cb);
    if (e.subs.size === 0) {
      clearInterval(e.timer);
      quotePolls.delete(symbol);
    }
  };
}

/** Fold each quote into the current candle bucket for `tf`. */
function subscribe(symbol: string, tf: Timeframe, onCandle: (c: Candle) => void): () => void {
  let current: Candle | null = null;
  return subscribeQuote(symbol, (q) => {
    const t = bucketStart(q.time, tf);
    if (!current || current.time !== t) {
      current = { time: t, open: q.price, high: q.price, low: q.price, close: q.price };
    } else {
      current = {
        ...current,
        high: Math.max(current.high, q.price),
        low: Math.min(current.low, q.price),
        close: q.price,
      };
    }
    onCandle(current);
  });
}

export const alpacaSource: DataSource = {
  id: "alpaca",
  label: "Alpaca (US stocks)",
  symbols: STOCK_SYMBOLS,
  timeframes: TIMEFRAMES,
  fetchHistory,
  subscribe,
};
