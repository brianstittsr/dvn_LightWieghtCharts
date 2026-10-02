import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { readJson, writeJson } from "@/lib/server-store";
import { toPublic, type TradingAccount } from "@/lib/settings";

const FILE = "users.json";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  platform: z.enum(["alpaca", "topstep", "apex", "schwab", "ninjatrader"]),
  apiKey: z.string().trim().max(200).optional(),
  apiSecret: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

async function load(): Promise<TradingAccount[]> {
  const list = await readJson<TradingAccount[]>(FILE, []);
  return Array.isArray(list) ? list : [];
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
  const users = await load();
  if (users.length >= 50) {
    return NextResponse.json({ error: "Account limit reached" }, { status: 400 });
  }
  const acct: TradingAccount = {
    id: randomUUID(),
    ...parsed.data,
    createdAt: new Date().toISOString(),
  };
  users.push(acct);
  await writeJson(FILE, users);
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
  await writeJson(FILE, next);
  return NextResponse.json({ data: { ok: true } });
}
