import crypto from "node:crypto";
import type { NextRequest } from "next/server";

/** HMAC-signed admin session cookie — signed with ADMIN_PASSWORD. */

export const ADMIN_COOKIE = "lwc-admin";
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8h

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function hmac(payload: string): string {
  return crypto
    .createHmac("sha256", process.env.ADMIN_PASSWORD ?? "")
    .update(payload)
    .digest("hex");
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function passwordMatches(pw: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEq(pw, expected);
}

export function makeToken(): string {
  const ts = Date.now().toString(36);
  return `${ts}.${hmac(ts)}`;
}

export function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const age = Date.now() - parseInt(ts, 36);
  return age >= 0 && age < MAX_AGE_MS && safeEq(sig, hmac(ts));
}

export function isAdmin(req: NextRequest): boolean {
  return tokenValid(req.cookies.get(ADMIN_COOKIE)?.value);
}
