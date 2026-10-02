import { NextResponse } from "next/server";
import { alpaca, alpacaConfigured, AlpacaError } from "@/lib/alpaca";

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}

export async function GET() {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  try {
    const positions = await alpaca<AlpacaPosition[]>("/v2/positions");
    return NextResponse.json({ data: positions });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status });
  }
}
