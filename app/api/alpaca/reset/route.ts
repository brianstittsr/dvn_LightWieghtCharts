import { NextResponse } from "next/server";
import { alpaca, alpacaConfigured, AlpacaError } from "@/lib/alpaca";

/**
 * "Reset" = flatten the paper account: cancel all open orders, then close all
 * positions. Alpaca's true balance reset is dashboard-only (it also rotates
 * API keys), so this is the closest API-supported equivalent — the account
 * ends all-cash, though realized P&L history still counts toward equity.
 */
export async function POST() {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  try {
    // Cancel every open order first so position closes don't conflict.
    await alpaca<unknown>("/v2/orders", { method: "DELETE" });
    const closed = await alpaca<unknown>("/v2/positions?cancel_orders=true", { method: "DELETE" });
    return NextResponse.json({ data: { closed } });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Reset failed" }, { status });
  }
}
