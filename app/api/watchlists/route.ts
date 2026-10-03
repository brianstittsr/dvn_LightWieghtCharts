import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Watchlist } from "@/lib/scanner/types";
import { verifyUser } from "@/lib/server-auth";
import { storeList, storePut } from "@/lib/store";

const listSchema = z.object({
  name: z.string().trim().min(1).max(60),
  assetClass: z.enum(["stock", "crypto", "future"]),
  symbols: z.array(z.string().trim().min(1).max(15)).min(1).max(100),
});

/** GET — the caller's watchlists. */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const lists = (await storeList<Watchlist>("watchlists.json")).filter(
    (w) => w.uid === uid,
  );
  return NextResponse.json({ data: { watchlists: lists } });
}

/** POST — create a watchlist. */
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = listSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const wl: Watchlist = {
    id: randomUUID(),
    uid,
    name: d.name,
    assetClass: d.assetClass,
    symbols: [...new Set(d.symbols.map((s) => s.toUpperCase()))],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storePut("watchlists.json", wl);
  return NextResponse.json({ data: { watchlist: wl } });
}
