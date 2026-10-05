import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { adminAuth, adminConfigured } from "@/lib/firebase-admin";

/** Lists Firebase Auth users (uid + email + created date) for account assignment. */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "Firebase Admin not configured — set FIREBASE_* env vars" },
      { status: 501 },
    );
  }
  try {
    const res = await (await adminAuth()).listUsers(200);
    return NextResponse.json({
      data: {
        users: res.users.map((u) => ({
          uid: u.uid,
          email: u.email ?? null,
          displayName: u.displayName ?? null,
          createdAt: u.metadata.creationTime,
          lastSignIn: u.metadata.lastSignInTime,
        })),
      },
    });
  } catch (e) {
    console.error("admin/auth-users:", e);
    return NextResponse.json(
      { error: "Failed to list Firebase users — check service-account env vars" },
      { status: 500 },
    );
  }
}
