import { NextResponse } from "next/server";
import { alpaca, alpacaConfigured, AlpacaError } from "@/lib/alpaca";

export interface MarketClock {
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export async function GET() {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  try {
    const clock = await alpaca<MarketClock>("/v2/clock");
    return NextResponse.json({ data: clock });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Clock failed" }, { status });
  }
}
