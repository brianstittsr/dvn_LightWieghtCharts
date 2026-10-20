import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { alpaca, alpacaConfigured, AlpacaError } from "@/lib/alpaca";

const tpSchema = z.union([
  z.number().positive(),
  z.object({ limit_price: z.number().positive() }),
]);
const slSchema = z.union([
  z.number().positive(),
  z.object({ stop_price: z.number().positive() }),
]);
const orderSchema = z.object({
  symbol: z.string().min(1).max(30),
  qty: z.number().positive(),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit"]).default("market"),
  limit_price: z.number().positive().optional(),
  time_in_force: z.enum(["day", "gtc", "ioc"]).optional(),
  take_profit: tpSchema.optional(),
  stop_loss: slSchema.optional(),
});

export async function GET() {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  try {
    const orders = await alpaca<unknown[]>("/v2/orders?status=all&limit=50&direction=desc");
    return NextResponse.json({ data: orders });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status });
  }
}

export async function POST(req: NextRequest) {
  if (!alpacaConfigured()) {
    return NextResponse.json({ error: "Alpaca keys not configured" }, { status: 501 });
  }
  const parsed = orderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid order: symbol, qty>0 and side buy|sell required" }, { status: 400 });
  }
  const { symbol, qty, side, type, limit_price } = parsed.data;
  const rawTp = parsed.data.take_profit;
  const rawSl = parsed.data.stop_loss;
  // Normalize to number regardless of shape
  const tpPrice = rawTp == null ? undefined : typeof rawTp === "number" ? rawTp : rawTp.limit_price;
  const slPrice = rawSl == null ? undefined : typeof rawSl === "number" ? rawSl : rawSl.stop_price;
  const isCrypto = symbol.includes("/");
  const tif = parsed.data.time_in_force ?? (isCrypto ? "gtc" : "day");
  if (type === "limit" && limit_price == null) {
    return NextResponse.json({ error: "limit_price required for limit orders" }, { status: 400 });
  }
  const bracket = tpPrice != null || slPrice != null;
  if (bracket && isCrypto) {
    return NextResponse.json({ error: "Bracket orders (TP/SL) are not supported for crypto" }, { status: 400 });
  }

  try {
    const order = await alpaca<unknown>("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol,
        qty: String(qty),
        side,
        type,
        time_in_force: tif,
        ...(limit_price != null ? { limit_price: String(limit_price) } : {}),
        ...(bracket
          ? {
              order_class: "bracket",
              ...(tpPrice != null ? { take_profit: { limit_price: String(tpPrice) } } : {}),
              ...(slPrice != null ? { stop_loss: { stop_price: String(slPrice) } } : {}),
            }
          : {}),
      }),
    });
    return NextResponse.json({ data: order }, { status: 201 });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status });
  }
}
