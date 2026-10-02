import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { alpacaData, alpacaConfigured, AlpacaError } from "@/lib/alpaca";
import type { Quote } from "@/lib/types";

const querySchema = z.object({ symbol: z.string().min(1).max(20) });

interface LatestTrade {
  trade?: { p?: number };
}

export async function GET(req: NextRequest) {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  const parsed = querySchema.safeParse({ symbol: req.nextUrl.searchParams.get("symbol") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query params" }, { status: 400 });
  }
  const { symbol } = parsed.data;

  try {
    const res = await alpacaData<LatestTrade>(`/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`);
    const price = res.trade?.p;
    if (price == null) {
      return NextResponse.json({ error: `No price for ${symbol}` }, { status: 404 });
    }
    const quote: Quote = { symbol, price, time: Math.floor(Date.now() / 1000) };
    return NextResponse.json({ data: quote });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch quote" }, { status });
  }
}
