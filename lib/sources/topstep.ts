import type { Candle } from "@/lib/types";
import type { DataSource } from "@/lib/data-sources";
import { FUTURE_SYMBOLS } from "@/lib/symbols";
import { TIMEFRAMES, bucketStart, type Timeframe } from "@/lib/timeframe";
import { authFetch } from "@/lib/auth-fetch";

const POLL_MS = 5_000;

interface ApiOk<T> {
  data: T;
}
interface ApiErr {
  error: string;
}

async function api<T>(path: string): Promise<T> {
  const res = await authFetch(path);
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!res.ok || !("data" in body)) {
    throw new Error("error" in body ? body.error : `Request failed: ${res.status}`);
  }
  return body.data;
}

interface BarsResponse {
  contractId: string;
  candles: Candle[];
}

async function fetchHistory(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const r = await api<BarsResponse>(
    `/api/futures/bars?symbol=${encodeURIComponent(symbol)}&tf=${tf}`,
  );
  return r.candles;
}

interface QuoteResponse {
  last: number | null;
  /** Unix seconds of the bar the price came from (staleness guard). */
  barTime: number | null;
}

/** Last-price polls shared per symbol across panes. */
const pricePolls = new Map<
  string,
  { timer: ReturnType<typeof setInterval>; subs: Set<(q: QuoteResponse) => void> }
>();

function subscribePrice(
  symbol: string,
  cb: (q: QuoteResponse) => void,
): () => void {
  let entry = pricePolls.get(symbol);
  if (!entry) {
    const subs = new Set<(q: QuoteResponse) => void>();
    const timer = setInterval(async () => {
      try {
        const q = await api<QuoteResponse>(
          `/api/futures/quote?platform=topstep&symbol=${encodeURIComponent(symbol)}`,
        );
        if (q.last != null) subs.forEach((fn) => fn(q));
      } catch (err) {
        console.error(`Futures price poll failed for ${symbol}:`, err);
      }
    }, POLL_MS);
    entry = { timer, subs };
    pricePolls.set(symbol, entry);
  }
  entry.subs.add(cb);
  return () => {
    const e = pricePolls.get(symbol);
    if (!e) return;
    e.subs.delete(cb);
    if (e.subs.size === 0) {
      clearInterval(e.timer);
      pricePolls.delete(symbol);
    }
  };
}

/**
 * Fold each polled last-price into the candle bucket of the BAR's own
 * timestamp — not wall-clock now — so quotes during the daily/weekend halt
 * update the last real bar instead of drawing a fake flat line forward.
 */
function subscribe(
  symbol: string,
  tf: Timeframe,
  onCandle: (c: Candle) => void,
): () => void {
  let current: Candle | null = null;
  return subscribePrice(symbol, (q) => {
    if (q.last == null) return;
    const price = q.last;
    const t = bucketStart(q.barTime ?? Math.floor(Date.now() / 1000), tf);
    if (!current || current.time !== t) {
      current = { time: t, open: price, high: price, low: price, close: price };
    } else {
      current = {
        ...current,
        high: Math.max(current.high, price),
        low: Math.min(current.low, price),
        close: price,
      };
    }
    onCandle(current);
  });
}

export const topstepSource: DataSource = {
  id: "futures",
  label: "Futures — TopStepX",
  symbols: FUTURE_SYMBOLS,
  timeframes: TIMEFRAMES,
  fetchHistory,
  subscribe,
};
