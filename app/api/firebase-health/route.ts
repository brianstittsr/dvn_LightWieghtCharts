import { NextResponse } from "next/server";
import { adminAuth, adminConfigured } from "@/lib/firebase-admin";

export const runtime = "nodejs";

/**
 * Unauthenticated diagnostic: reports whether Firebase Admin can initialize
 * and actually use its credential (listUsers forces a signed request).
 * Returns only booleans + a truncated error — no secrets.
 */
export async function GET(): Promise<NextResponse> {
  if (!adminConfigured()) {
    return NextResponse.json({
      configured: false,
      authOk: false,
      error: "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not all set",
    });
  }
  try {
    const auth = await adminAuth();
    await auth.listUsers(1);
    return NextResponse.json({ configured: true, authOk: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ configured: true, authOk: false, error: msg.slice(0, 300) });
  }
}
