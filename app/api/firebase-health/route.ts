import { NextResponse, type NextRequest } from "next/server";
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
    // projectId is public (it ships in every client bundle) — safe to report
    // so we can spot a client/admin project mismatch.
    return NextResponse.json({
      configured: true,
      authOk: true,
      projectId: process.env.FIREBASE_PROJECT_ID ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      configured: true,
      authOk: false,
      projectId: process.env.FIREBASE_PROJECT_ID ?? null,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? null,
      error: msg.slice(0, 300),
    });
  }
}

/**
 * POST with `Authorization: Bearer <idToken>` — reports whether the token
 * verifies and under which uid. Lets us distinguish "not signed in" from
 * "signed in to a different Firebase project" on the deployed site.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return NextResponse.json({ tokenOk: false, error: "missing bearer token" });
  try {
    const decoded = await (await adminAuth()).verifyIdToken(token);
    return NextResponse.json({ tokenOk: true, uid: decoded.uid, email: decoded.email ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ tokenOk: false, error: msg.slice(0, 300) });
  }
}
