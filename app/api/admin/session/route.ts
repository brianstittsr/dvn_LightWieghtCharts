import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminConfigured, isAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    data: { authed: isAdmin(req), configured: adminConfigured() },
  });
}

/** Logout — clear the admin cookie. */
export async function DELETE() {
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
