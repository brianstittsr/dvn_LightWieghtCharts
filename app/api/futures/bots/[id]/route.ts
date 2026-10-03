import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getBot,
  killBot,
  listBots,
  saveBot,
  startBot,
  stopBot,
} from "@/lib/futures-bots";
import { verifyUser } from "@/lib/server-auth";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  accountId: z.number().int().positive().optional(),
  contractId: z.string().min(1).optional(),
  contractName: z.string().max(80).optional(),
  timeframe: z.enum(["30s", "1m", "5m", "15m", "1h"]).optional(),
  size: z.number().int().min(1).max(500).optional(),
  slPoints: z.number().min(0).max(100000).optional(),
  tpPoints: z.number().min(0).max(100000).optional(),
  strategy: z
    .discriminatedUnion("kind", [
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
    ])
    .optional(),
});

const actionSchema = z.object({ action: z.enum(["start", "stop", "kill"]) });

async function owned(req: NextRequest, id: string) {
  const uid = await verifyUser(req);
  const bots = await listBots(uid);
  return bots.some((b) => b.id === id);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!(await owned(req, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid update" },
      { status: 400 },
    );
  }
  const bot = await getBot(id);
  if (!bot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  Object.assign(bot, parsed.data, { updatedAt: new Date().toISOString() });
  await saveBot(bot);
  return NextResponse.json({ data: { bot } });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!(await owned(req, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "action: start|stop|kill" }, { status: 400 });
  }
  try {
    switch (parsed.data.action) {
      case "start":
        await startBot(id);
        return NextResponse.json({ data: { ok: true } });
      case "stop":
        await stopBot(id);
        return NextResponse.json({ data: { ok: true } });
      case "kill":
        return NextResponse.json({ data: await killBot(id) });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed" },
      { status: 502 },
    );
  }
}
