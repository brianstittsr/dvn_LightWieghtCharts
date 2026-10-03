import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  listAlpacaBots,
  saveAlpacaBot,
  type AlpacaBot,
} from "@/lib/alpaca-bots";
import { verifyUser } from "@/lib/server-auth";

const strategySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ema-cross"),
    fastLen: z.number().int().min(1).max(500),
    slowLen: z.number().int().min(2).max(1000),
  }),
  z.object({
    kind: z.literal("custom"),
    name: z.string().min(1).max(80),
    prompt: z.string().max(4000),
    code: z.string().min(1).max(20000),
    params: z.record(z.string(), z.number()),
  }),
]);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  symbol: z.string().trim().min(1).max(15),
  assetClass: z.enum(["stock", "crypto"]),
  timeframe: z.enum(["1m", "5m", "15m", "1h"]),
  qty: z.number().positive().max(100000),
  slPct: z.number().min(0).max(90).default(0),
  tpPct: z.number().min(0).max(500).default(0),
  strategy: strategySchema,
});

/** GET — the caller's Alpaca bots. */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ data: { bots: await listAlpacaBots(uid) } });
}

/** POST — create an Alpaca bot (stocks or crypto). */
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const bot: AlpacaBot = {
    id: randomUUID(),
    ownerUid: uid,
    name: d.name,
    symbol: d.symbol.toUpperCase(),
    assetClass: d.assetClass,
    timeframe: d.timeframe,
    qty: d.qty,
    slPct: d.slPct,
    tpPct: d.tpPct,
    strategy: d.strategy,
    state: "stopped",
    events: [
      { t: new Date().toISOString(), type: "info", msg: "Bot created" },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveAlpacaBot(bot);
  return NextResponse.json({ data: { bot } }, { status: 201 });
}
