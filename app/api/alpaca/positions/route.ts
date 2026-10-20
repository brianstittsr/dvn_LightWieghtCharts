import { NextRequest, NextResponse } from "next/server";
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

/**
 * DELETE ?symbol=X — close a position at market.
 * Optional: &qty=N for partial close (number of shares/units).
 *           &percentage=P to close P% of the position.
 */
export async function DELETE(req: NextRequest) {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const qty = req.nextUrl.searchParams.get("qty");
  const percentage = req.nextUrl.searchParams.get("percentage");
  try {
    const params = new URLSearchParams();
    if (qty) params.set("qty", qty);
    else if (percentage) params.set("percentage", percentage);
    const qs = params.toString();
    const order = await alpaca<unknown>(
      `/v2/positions/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ""}`,
      { method: "DELETE" },
    );
    return NextResponse.json({ data: order });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status });
  }
}
