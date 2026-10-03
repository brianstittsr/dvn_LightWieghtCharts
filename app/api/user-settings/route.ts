import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { UserSettings } from "@/lib/scanner/types";
import { verifyUser } from "@/lib/server-auth";
import { storeList, storePut } from "@/lib/store";

const putSchema = z.object({
  telegramBotToken: z.string().max(200).optional(),
  telegramChatId: z.string().max(50).optional(),
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
    updatedAt: new Date().toISOString(),
  };
  await storePut("user-settings.json", doc);
  return NextResponse.json({
    data: {
      telegramBotTokenMasked: mask(doc.telegramBotToken),
      telegramChatId: doc.telegramChatId,
      hasTelegram: Boolean(doc.telegramBotToken && doc.telegramChatId),
    },
  });
}
