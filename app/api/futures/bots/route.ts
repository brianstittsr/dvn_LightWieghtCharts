import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  botRunning,
  deleteBot,
  listBots,
  saveBot,
  type FuturesBot,
} from "@/lib/futures-bots";
import { verifyUser } from "@/lib/server-auth";

const strategySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ema-cross"),
    fastLen: z.number().int().min(1).max(500),
    slowLen: z.number().int().min(2).max(1000),
    initialFast: z.number().optional(),
    initialSlow: z.number().optional(),
  }),
  z.object({
    kind: z.literal("custom"),
    name: z.string().trim().min(1).max(80),
    prompt: z.string().max(4000).default(""),
    code: z.string().min(1).max(20000),
    params: z.record(z.string(), z.number()).default({}),
  }),
]);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  platform: z.enum(["topstep", "apex"]),
  accountId: z.number().int().positive().optional(),
  contractId: z.string().min(1),
  contractName: z.string().max(80).optional(),
  timeframe: z.enum(["30s", "1m", "5m", "15m", "1h"]),
  size: z.number().int().min(1).max(500),
  slPoints: z.number().min(0).max(100000),
  tpPoints: z.number().min(0).max(100000),
  strategy: strategySchema,
});

export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  const bots = await listBots(uid);
  return NextResponse.json({
    data: {
      bots: bots.map((b) => ({
        ...b,
        events: b.events.slice(0, 50),
        running: botRunning(b.id),
      })),
    },
  });
}

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid bot config" },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  const bot: FuturesBot = {
    id: randomUUID(),
    ownerUid: uid,
    ...parsed.data,
    state: "stopped",
    events: [{ t: now, type: "info", msg: "Bot created" }],
    createdAt: now,
    updatedAt: now,
  };
  await saveBot(bot);
  return NextResponse.json({ data: { bot } });
}

export async function DELETE(req: NextRequest) {
  const uid = await verifyUser(req);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const owned = (await listBots(uid)).some((b) => b.id === id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteBot(id);
  return NextResponse.json({ data: { ok: true } });
}
