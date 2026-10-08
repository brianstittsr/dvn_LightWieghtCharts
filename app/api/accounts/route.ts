import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyUser } from "@/lib/server-auth";
import { storeDelete, storeList, storePut } from "@/lib/store";
import { toPublic, type TradingAccount } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Self-serve API credentials — each signed-in user manages their own
 * trading-account records (ownerUid = their Firebase uid). Secrets are
 * stored server-side and never returned; GET responses are masked.
 *
 * Field mapping per platform:
 *   alpaca        apiKey=Key ID           apiSecret=Secret
 *   topstep/apex  apiKey=platform login   apiSecret=ProjectX API key  accountId=eval acct
 *   forex         apiKey=username         apiSecret=password          appKey=AppKey
 */
const saveSchema = z.object({
  platform: z.enum(["alpaca", "topstep", "apex", "forex"]),
  name: z.string().trim().max(60).optional(),
  accountId: z.number().int().positive().nullish(),
  apiKey: z.string().trim().max(200).optional(),
  apiSecret: z.string().trim().max(200).optional(),
  appKey: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

const PLATFORM_LABEL: Record<string, string> = {
  alpaca: "Alpaca",
  topstep: "TopStep",
  apex: "Apex",
  forex: "FOREX.com",
};

async function myAccounts(uid: string): Promise<TradingAccount[]> {
  return (await storeList<TradingAccount>("users.json")).filter(
    (a) => a.ownerUid === uid,
  );
}

/** GET — the caller's accounts, secrets masked. */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await myAccounts(uid);
  return NextResponse.json({ data: { accounts: accounts.map(toPublic) } });
}

/**
 * POST — create or update the caller's account for a platform
 * (one record per platform per user; undefined fields keep existing
 * values, empty strings clear them).
 */
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const existing = (await myAccounts(uid)).find((a) => a.platform === d.platform);
  const keep = <T>(next: T | undefined, prev: T | undefined): T | undefined =>
    next === undefined ? prev : next || undefined;

  const acct: TradingAccount = {
    id: existing?.id ?? randomUUID(),
    ownerUid: uid,
    name: d.name || existing?.name || `${PLATFORM_LABEL[d.platform]} account`,
    platform: d.platform,
    accountId: d.accountId === null ? undefined : (d.accountId ?? existing?.accountId),
    apiKey: keep(d.apiKey, existing?.apiKey),
    apiSecret: keep(d.apiSecret, existing?.apiSecret),
    appKey: keep(d.appKey, existing?.appKey),
    notes: d.notes !== undefined ? d.notes || undefined : existing?.notes,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await storePut("users.json", acct);
  return NextResponse.json({ data: { account: toPublic(acct) } });
}

/** DELETE ?platform=forex — remove the caller's account for a platform. */
export async function DELETE(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const platform = req.nextUrl.searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "platform required" }, { status: 400 });
  const mine = (await myAccounts(uid)).filter((a) => a.platform === platform);
  await Promise.all(mine.map((a) => storeDelete("users.json", a.id)));
  return NextResponse.json({ data: { ok: true, removed: mine.length } });
}
