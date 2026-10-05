import type { NextRequest } from "next/server";
import { adminAuth, adminConfigured } from "@/lib/firebase-admin";

/**
 * Verify the caller's Firebase ID token (Authorization: Bearer <token>) and
 * return their uid. Returns null when unauthenticated or Admin isn't configured.
 */
export async function verifyUser(req: NextRequest): Promise<string | null> {
  if (!adminConfigured()) return null;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return (await (await adminAuth()).verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}
