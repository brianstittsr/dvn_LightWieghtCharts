import { NextResponse } from "next/server";
import { alpaca, alpacaConfigured, AlpacaError } from "@/lib/alpaca";

export async function GET() {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  try {
    const account = await alpaca<unknown>("/v2/account");
    return NextResponse.json({ data: account });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status });
  }
}
