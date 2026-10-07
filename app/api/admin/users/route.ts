import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { adminAuth, adminConfigured } from "@/lib/firebase-admin";
import { storeDelete, storeList, storePut } from "@/lib/store";
import { toPublic, type TradingAccount } from "@/lib/settings";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  ownerEmail: z.string().trim().email().max(200).optional(),
  platform: z.enum(["alpaca", "topstep", "apex", "schwab", "ninjatrader", "forex"]),
  accountId: z.number().int().positive().optional(),
  apiKey: z.string().trim().max(200).optional(),
  apiSecret: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

async function load(): Promise<TradingAccount[]> {
  return storeList<TradingAccount>("users.json");
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ data: { users: (await load()).map(toPublic) } });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { ownerEmail, ...rest } = parsed.data;

  // Resolve the owner's email to a Firebase uid when provided.
  let ownerUid: string | undefined;
  if (ownerEmail) {
    if (!adminConfigured()) {
      return NextResponse.json(
        { error: "Firebase Admin not configured — set FIREBASE_* env vars" },
        { status: 501 },
      );
    }
    try {
      ownerUid = (await (await adminAuth()).getUserByEmail(ownerEmail)).uid;
    } catch {
      return NextResponse.json(
        { error: `No Firebase user found for ${ownerEmail}` },
        { status: 404 },
      );
    }
  }

  const users = await load();
  if (users.length >= 50) {
    return NextResponse.json({ error: "Account limit reached" }, { status: 400 });
  }
  const acct: TradingAccount = {
    id: randomUUID(),
    ...rest,
    ownerUid,
    ownerEmail: ownerEmail ?? undefined,
    createdAt: new Date().toISOString(),
  };
  users.push(acct);
  await storePut("users.json", acct);
  return NextResponse.json({ data: { user: toPublic(acct) } });
}

export async function DELETE(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const users = await load();
  const next = users.filter((u) => u.id !== id);
  if (next.length === users.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await storeDelete("users.json", id);
  return NextResponse.json({ data: { ok: true } });
}
