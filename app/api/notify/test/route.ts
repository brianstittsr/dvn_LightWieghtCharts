import { NextRequest, NextResponse } from "next/server";
import { sendTelegram, telegramCredsFor } from "@/lib/notify";
import { verifyUser } from "@/lib/server-auth";

/** GET — is Telegram configured for this user (per-user or env fallback)? */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const creds = await telegramCredsFor(uid);
  return NextResponse.json({ data: { configured: Boolean(creds) } });
}

/** POST — send a test message as the caller. */
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await sendTelegram(
    uid,
    "✅ Scanner alerts connected — you'll get scan hits here.",
  );
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ data: { sent: true } });
}
