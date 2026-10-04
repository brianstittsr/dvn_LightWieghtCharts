import { NextRequest, NextResponse } from "next/server";
import { cryptoNews } from "@/lib/crypto-news";
import { verifyUser } from "@/lib/server-auth";

/**
 * GET /api/crypto-news[?symbol=BTC] — merged crypto RSS headlines, tagged
 * per coin. `symbol` filters to items mentioning that coin.
 */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  try {
    const items = await cryptoNews();
    const filtered = symbol
      ? items.filter((i) => i.coins.includes(symbol))
      : items;
    return NextResponse.json({ data: { items: filtered } });
  } catch {
    return NextResponse.json({ error: "News feeds unavailable" }, { status: 502 });
  }
}
