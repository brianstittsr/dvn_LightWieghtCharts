import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { alpacaData, alpacaConfigured, AlpacaError } from "@/lib/alpaca";
import type { Candle } from "@/lib/types";
import type { Timeframe } from "@/lib/timeframe";

const querySchema = z.object({
  symbol: z.string().min(1).max(20),
  interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
});

const ALPACA_TF: Record<Timeframe, string> = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1h": "1Hour",
  "4h": "4Hour",
  "1d": "1Day",
};

/** How far back to request per timeframe. */
const LOOKBACK_DAYS: Record<Timeframe, number> = {
  "1m": 5,
  "5m": 20,
  "15m": 40,
  "1h": 120,
  "4h": 365,
  "1d": 1826,
};

interface AlpacaBar {
  t: string; // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface BarsResponse {
  bars?: AlpacaBar[];
}

/** Once a boats request is rejected (no subscription), stop asking for it. */
let boatsBlocked = false;

export async function GET(req: NextRequest) {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  const parsed = querySchema.safeParse({
    symbol: req.nextUrl.searchParams.get("symbol"),
    interval: req.nextUrl.searchParams.get("interval"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query params" }, { status: 400 });
  }
  const { symbol, interval } = parsed.data as { symbol: string; interval: Timeframe };

  try {
    const start = new Date(Date.now() - LOOKBACK_DAYS[interval] * 86400_000).toISOString();
    const path = `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${ALPACA_TF[interval]}&start=${encodeURIComponent(start)}&limit=5000`;
    // Merge regular-session bars with Blue Ocean (overnight) bars so
    // Asia/London session data exists on stock charts too.
    const [rth, overnight] = await Promise.all([
      alpacaData<BarsResponse>(path),
      boatsBlocked
        ? Promise.resolve({ bars: [] } as BarsResponse)
        : alpacaData<BarsResponse>(path, "boats").catch((err: unknown) => {
            if (err instanceof AlpacaError && (err.status === 401 || err.status === 403)) boatsBlocked = true;
            console.error("boats feed failed:", err instanceof Error ? err.message : err);
            return { bars: [] } as BarsResponse;
          }),
    ]);
    const seen = new Map<number, Candle>();
    for (const b of [...(overnight.bars ?? []), ...(rth.bars ?? [])]) {
      seen.set(Math.floor(new Date(b.t).getTime() / 1000), {
        time: Math.floor(new Date(b.t).getTime() / 1000),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      });
    }
    const candles = [...seen.values()].sort((a, b) => a.time - b.time);
    return NextResponse.json({ data: candles });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch bars" }, { status });
  }
}
