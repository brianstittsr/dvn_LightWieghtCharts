import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { barsRangeFor } from "@/lib/scanner/data";
import { verifyUser } from "@/lib/server-auth";
import { TIMEFRAMES, TIMEFRAME_SECONDS, type Timeframe } from "@/lib/timeframe";

const querySchema = z.object({
  assetClass: z.enum(["stock", "crypto", "future"]).default("stock"),
  symbol: z.string().min(1).max(15),
  tf: z.enum(TIMEFRAMES).default("5m"),
  /** Range bounds as unix seconds. */
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

/** Max candles per timeframe a range request may return. */
const MAX_BARS: Record<Timeframe, number> = {
  "1m": 10_000,
  "5m": 10_000,
  "15m": 10_000,
  "30m": 10_000,
  "45m": 10_000,
  "1h": 8_000,
  "2h": 8_000,
  "4h": 6_000,
  "6h": 6_000,
  "8h": 6_000,
  "12h": 6_000,
  "16h": 6_000,
  "1d": 5_000,
  "2D": 5_000,
  "W": 5_000,
  "M": 5_000,
};

/** GET — candles over an explicit date range for the strategy optimizer. */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = querySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json({ error: "assetClass, symbol, tf, from, to required" }, { status: 400 });
  }
  const { assetClass, symbol, tf, from, to } = parsed.data;
  if (from >= to) {
    return NextResponse.json({ error: "`from` must be before `to`" }, { status: 400 });
  }
  const spanBars = Math.ceil((to - from) / TIMEFRAME_SECONDS[tf]);
  if (spanBars > MAX_BARS[tf]) {
    return NextResponse.json(
      {
        error: `Range too large for ${tf} (≈${spanBars.toLocaleString()} bars, max ${MAX_BARS[tf].toLocaleString()}) — narrow the dates or use a higher timeframe`,
      },
      { status: 400 },
    );
  }

  try {
    const candles = await barsRangeFor(assetClass, symbol, tf, from, to, uid);
    return NextResponse.json({ candles, count: candles.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
  }
}
