import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  alpacaBotPosition,
  alpacaBotRunning,
  deleteAlpacaBot,
  getAlpacaBot,
  killAlpacaBot,
  saveAlpacaBot,
  startAlpacaBot,
  stopAlpacaBot,
} from "@/lib/alpaca-bots";
import { verifyUser } from "@/lib/server-auth";

const actionSchema = z.object({ action: z.enum(["start", "stop", "kill"]) });

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  qty: z.number().positive().max(100000).optional(),
  slPct: z.number().min(0).max(90).optional(),
  tpPct: z.number().min(0).max(500).optional(),
  timeframe: z.enum(["1m", "5m", "15m", "1h"]).optional(),
  strategy: z
    .discriminatedUnion("kind", [
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
    ])
    .optional(),
});

async function ownedBot(
  req: NextRequest,
  id: string,
): Promise<{ uid: string; bot: NonNullable<Awaited<ReturnType<typeof getAlpacaBot>>> } | NextResponse> {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bot = await getAlpacaBot(id);
  if (!bot || bot.ownerUid !== uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return { uid, bot };
}

/** GET — bot detail + live position + running flag. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await ownedBot(req, id);
  if (owned instanceof NextResponse) return owned;
  const position = await alpacaBotPosition(owned.bot).catch(() => null);
  return NextResponse.json({
    data: { bot: owned.bot, running: alpacaBotRunning(id), position },
  });
}

/** POST — actions: start | stop | kill. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await ownedBot(req, id);
  if (owned instanceof NextResponse) return owned;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "action must be start|stop|kill" }, { status: 400 });
  }
  try {
    if (parsed.data.action === "start") await startAlpacaBot(id);
    else if (parsed.data.action === "stop") await stopAlpacaBot(id);
    else return NextResponse.json({ data: await killAlpacaBot(id) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: { ok: true, running: alpacaBotRunning(id) } });
}

/** PATCH — update params while stopped or running. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await ownedBot(req, id);
  if (owned instanceof NextResponse) return owned;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  Object.assign(owned.bot, parsed.data);
  await saveAlpacaBot(owned.bot);
  return NextResponse.json({ data: { bot: owned.bot } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await ownedBot(req, id);
  if (owned instanceof NextResponse) return owned;
  await deleteAlpacaBot(id);
  return NextResponse.json({ data: { deleted: true } });
}
