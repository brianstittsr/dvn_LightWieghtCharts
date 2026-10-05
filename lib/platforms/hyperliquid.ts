/**
 * Server-side Hyperliquid market-data client — public REST API, no creds.
 * Used by the crypto scanner and Alpaca-venue crypto bots' price feeds.
 */

const REST_URL = "https://api.hyperliquid.xyz/info";

export interface HlCandle {
  t: number; // open time ms
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

interface HlMeta {
  universe: { name: string }[];
}
interface HlAssetCtx {
  markPx: string;
  dayNtlVlm: string;
  prevDayPx: string;
}

async function hl<T>(body: object): Promise<T> {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Hyperliquid error ${res.status}`);
  return (await res.json()) as T;
}

/** Latest mark prices for every coin. */
export async function hlMids(): Promise<Record<string, number>> {
  const mids = await hl<Record<string, string>>({ type: "allMids" });
  return Object.fromEntries(Object.entries(mids).map(([k, v]) => [k, Number(v)]));
}

/** Per-coin daily context (prev-day close + 24h notional volume). */
export async function hlAssetCtxs(): Promise<
  Map<string, { markPx: number; dayNtlVlm: number; prevDayPx: number }>
> {
  const [meta, ctxs] = await hl<[HlMeta, HlAssetCtx[]]>({
    type: "metaAndAssetCtxs",
  });
  const map = new Map<string, { markPx: number; dayNtlVlm: number; prevDayPx: number }>();
  meta.universe.forEach((u, i) => {
    const ctx = ctxs[i];
    if (ctx) {
      map.set(u.name, {
        markPx: Number(ctx.markPx),
        dayNtlVlm: Number(ctx.dayNtlVlm),
        prevDayPx: Number(ctx.prevDayPx),
      });
    }
  });
  return map;
}

/** Candles for a coin. interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d". */
export async function hlCandles(
  coin: string,
  interval: string,
  limit = 300,
  range?: { startMs: number; endMs: number },
): Promise<HlCandle[]> {
  const seconds: Record<string, number> = {
    "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400,
  };
  const s = seconds[interval] ?? 60;
  const endTime = range?.endMs ?? Date.now();
  const startTime = range?.startMs ?? endTime - s * (limit + 10) * 1000;
  const rows = await hl<HlCandle[]>({
    type: "candleSnapshot",
    req: { coin, interval, startTime, endTime },
  });
  return rows.slice(-limit);
}
