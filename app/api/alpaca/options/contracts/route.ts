import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { alpaca, alpacaConfigured, AlpacaError } from "@/lib/alpaca";

const querySchema = z.object({
  underlying: z.string().min(1).max(10),
  type: z.enum(["call", "put"]).optional(),
});

export interface OptionContract {
  id: string;
  symbol: string; // OCC format, e.g. AAPL260116C00200000
  expiration_date: string;
  strike_price: string;
  type: "call" | "put";
}

interface ContractsResponse {
  option_contracts?: OptionContract[];
}

/** List active option contracts for an underlying (next ~60 days, 60 closest strikes each side). */
export async function GET(req: NextRequest) {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  const parsed = querySchema.safeParse({
    underlying: req.nextUrl.searchParams.get("underlying"),
    type: req.nextUrl.searchParams.get("type") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query params" }, { status: 400 });
  }
  const { underlying, type } = parsed.data;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      underlying_symbols: underlying.toUpperCase(),
      status: "active",
      expiration_date_gte: today,
      expiration_date_lte: horizon,
      limit: "1000",
    });
    if (type) params.set("type", type);
    const res = await alpaca<ContractsResponse>(`/v2/options/contracts?${params}`);
    const contracts = (res.option_contracts ?? []).map((c) => ({
      symbol: c.symbol,
      expiration: c.expiration_date,
      strike: Number(c.strike_price),
      type: c.type,
    }));
    return NextResponse.json({ data: contracts });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Contracts fetch failed" }, { status });
  }
}
