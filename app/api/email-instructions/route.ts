import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminConfigured } from "@/lib/firebase-admin";
import { BROKERS } from "@/lib/onboarding-content";
import { verifyUser } from "@/lib/server-auth";

const schema = z.object({ broker: z.string().min(1).max(40) });

/**
 * POST {broker} — email the caller that broker's API-setup instructions via
 * Resend when RESEND_API_KEY + EMAIL_FROM are set. Returns
 * `{ data: { sent } }` or 501 `{ error, mailto: true }` so the client can
 * fall back to a prefilled mailto: link.
 */
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "broker required" }, { status: 400 });
  }
  const broker = BROKERS.find((b) => b.id === parsed.data.broker);
  if (!broker?.emailSubject || !broker.emailBody) {
    return NextResponse.json({ error: "No email content for that broker" }, { status: 404 });
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !adminConfigured()) {
    return NextResponse.json(
      { error: "Email provider not configured", mailto: true },
      { status: 501 },
    );
  }
  let email: string | undefined;
  try {
    email = (await (await adminAuth()).getUser(uid)).email ?? undefined;
  } catch {
    /* fall through */
  }
  if (!email) {
    return NextResponse.json({ error: "No email on account" }, { status: 400 });
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: broker.emailSubject,
      text: broker.emailBody,
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Email send failed" }, { status: 502 });
  }
  return NextResponse.json({ data: { sent: true } });
}
