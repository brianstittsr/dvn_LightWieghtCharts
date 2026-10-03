import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureScannerScheduler } from "@/lib/scanner/scheduler";
import type { ScannerConfig } from "@/lib/scanner/types";
import { verifyUser } from "@/lib/server-auth";
import { storeDelete, storeList, storePut } from "@/lib/store";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
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
  schedule: z
    .object({
      enabled: z.boolean(),
      windowStartEt: z.number().int().min(0).max(1439),
      windowEndEt: z.number().int().min(0).max(1439),
      intervalMin: z.number().int().min(1).max(1440),
      weekdaysOnly: z.boolean(),
    })
    .optional(),
});

async function ownedConfig(
  req: NextRequest,
  id: string,
): Promise<{ uid: string; cfg?: ScannerConfig } | NextResponse> {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = (await storeList<ScannerConfig>("scanner-configs.json")).find(
    (c) => c.id === id,
  );
  if (!cfg || cfg.ownerUid !== uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return { uid, cfg };
}

/** PATCH — update name/filters/universe/strategy/schedule. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  ensureScannerScheduler();
  const { id } = await params;
  const owned = await ownedConfig(req, id);
  if (owned instanceof NextResponse) return owned;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const cfg = {
    ...owned.cfg!,
    ...d,
    universe: d.universe?.map((s) => s.toUpperCase()) ?? owned.cfg!.universe,
    updatedAt: new Date().toISOString(),
  };
  await storePut("scanner-configs.json", cfg);
  return NextResponse.json({ data: { config: cfg } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  ensureScannerScheduler();
  const { id } = await params;
  const owned = await ownedConfig(req, id);
  if (owned instanceof NextResponse) return owned;
  await storeDelete("scanner-configs.json", id);
  return NextResponse.json({ data: { deleted: true } });
}
