import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureScannerScheduler } from "@/lib/scanner/scheduler";
import { DEFAULT_SCHEDULES, type ScannerConfig } from "@/lib/scanner/types";
import { verifyUser } from "@/lib/server-auth";
import { storeList, storePut } from "@/lib/store";
import { randomUUID } from "crypto";

const scheduleSchema = z.object({
  enabled: z.boolean(),
  windowStartEt: z.number().int().min(0).max(1439),
  windowEndEt: z.number().int().min(0).max(1439),
  intervalMin: z.number().int().min(1).max(1440),
  weekdaysOnly: z.boolean(),
});

const configSchema = z.object({
  kind: z.enum(["gappers", "setup"]),
  name: z.string().min(1).max(80),
  filters: z
    .object({
      minGapPct: z.number().min(0).max(500),
      minPrice: z.number().min(0),
      minPremarketVolume: z.number().int().min(0),
      topN: z.number().int().min(1).max(30),
    })
    .optional(),
  universe: z.array(z.string().min(1).max(12)).max(50).optional(),
  strategyId: z.string().optional(),
  strategyCode: z.string().optional(),
  strategyParams: z.record(z.string(), z.number()).optional(),
  schedule: scheduleSchema.optional(),
});

/** GET — the caller's saved scanner configs. */
export async function GET(req: NextRequest) {
  ensureScannerScheduler();
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const configs = (await storeList<ScannerConfig>("scanner-configs.json")).filter(
    (c) => c.ownerUid === uid,
  );
  return NextResponse.json({ data: { configs } });
}

/** POST — create a scanner config (defaults from the article's schedule). */
export async function POST(req: NextRequest) {
  ensureScannerScheduler();
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = configSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const cfg: ScannerConfig = {
    id: randomUUID(),
    ownerUid: uid,
    kind: d.kind,
    name: d.name,
    filters: d.filters,
    universe: d.universe?.map((s) => s.toUpperCase()),
    strategyId: d.strategyId,
    strategyCode: d.strategyCode,
    strategyParams: d.strategyParams,
    schedule: d.schedule ?? DEFAULT_SCHEDULES[d.kind],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storePut("scanner-configs.json", cfg);
  return NextResponse.json({ data: { config: cfg } });
}
