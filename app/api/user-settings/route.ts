import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { UserSettings } from "@/lib/scanner/types";
import { verifyUser } from "@/lib/server-auth";
import { storeList, storePut } from "@/lib/store";

const profileSchema = z.object({
  onboarded: z.boolean(),
  tradingStyles: z.array(z.string().max(40)).max(10).default([]),
  experience: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  brokers: z.array(z.string().max(40)).max(20).default([]),
  interests: z
    .array(
      z.enum([
        "backtesting",
        "bots",
        "live-trading",
        "technical-analysis",
        "premarket",
        "prop-firm",
      ]),
    )
    .max(10)
    .default([]),
  guideProgress: z.record(z.string(), z.boolean()).default({}),
  guideDismissed: z.boolean().optional(),
  completedAt: z.string().optional(),
});

const putSchema = z.object({
  telegramBotToken: z.string().max(200).optional(),
  telegramChatId: z.string().max(50).optional(),
  profile: profileSchema.optional(),
});

const mask = (v?: string): string | undefined =>
  v ? `••••${v.slice(-4)}` : undefined;

/** GET — the caller's settings, secrets masked. */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const doc = (await storeList<UserSettings>("user-settings.json")).find(
    (d) => d.uid === uid,
  );
  return NextResponse.json({
    data: {
      telegramBotTokenMasked: mask(doc?.telegramBotToken),
      telegramChatId: doc?.telegramChatId,
      hasTelegram: Boolean(doc?.telegramBotToken && doc?.telegramChatId),
      envFallback: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
      ),
      profile: doc?.profile ?? null,
    },
  });
}

/** PUT — save the caller's Telegram creds (empty token clears it). */
export async function PUT(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  try {
    const existing = (await storeList<UserSettings>("user-settings.json")).find(
      (d) => d.uid === uid,
    );
    const d = parsed.data;
    const doc: UserSettings = {
      id: existing?.id ?? uid,
      uid,
      telegramBotToken:
        d.telegramBotToken !== undefined
          ? d.telegramBotToken || undefined
          : existing?.telegramBotToken,
      telegramChatId:
        d.telegramChatId !== undefined
          ? d.telegramChatId || undefined
          : existing?.telegramChatId,
      profile: d.profile !== undefined ? d.profile : existing?.profile,
      updatedAt: new Date().toISOString(),
    };
    await storePut("user-settings.json", doc);
    return NextResponse.json({
      data: {
        telegramBotTokenMasked: mask(doc.telegramBotToken),
        telegramChatId: doc.telegramChatId,
        hasTelegram: Boolean(doc.telegramBotToken && doc.telegramChatId),
        profile: doc.profile ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Settings save failed: ${msg.slice(0, 200)}` }, { status: 500 });
  }
}
