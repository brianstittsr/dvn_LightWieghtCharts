import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { alpacaConfigured, AlpacaError } from "@/lib/alpaca";
import { runGappersScan } from "@/lib/scanner/gappers";
import { watchlistSymbols } from "@/lib/scanner/watchlists";
import {
  DEFAULT_GAP_FILTERS,
  type ScanRun,
} from "@/lib/scanner/types";
import { ensureScannerScheduler } from "@/lib/scanner/scheduler";
import { verifyUser } from "@/lib/server-auth";
import { storeList, storePut } from "@/lib/store";
import { randomUUID } from "crypto";

const filtersSchema = z.object({
  assetClass: z.enum(["stock", "crypto", "future"]).default("stock"),
  universe: z.array(z.string().min(1).max(15)).max(100).optional(),
  watchlistId: z.string().optional(),
  minGapPct: z.number().min(0).max(500).optional(),
  minPrice: z.number().min(0).optional(),
  minPremarketVolume: z.number().min(0).optional(),
  topN: z.number().int().min(1).max(30).optional(),
});

/** POST — run the gapper scan now with optional filter overrides. */
export async function POST(req: NextRequest) {
  ensureScannerScheduler();
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!alpacaConfigured()) {
    return NextResponse.json(
      { error: "Alpaca API keys are not configured" },
      { status: 501 },
    );
  }
  const parsed = filtersSchema.safeParse(await req.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : { assetClass: "stock" as const };
  const filters = { ...DEFAULT_GAP_FILTERS, ...body };
  const universe =
    body.universe ?? (await watchlistSymbols(uid, body.watchlistId));
  try {
    const gappers = await runGappersScan(filters, {
      assetClass: body.assetClass,
      universe,
      uid,
    });
    const run: ScanRun = {
      id: randomUUID(),
      kind: "gappers",
      ownerUid: uid,
      assetClass: body.assetClass,
      ranAt: new Date().toISOString(),
      gappers,
    };
    await storePut("scan-runs.json", run);
    return NextResponse.json({ data: run });
  } catch (err) {
    const msg =
      err instanceof AlpacaError || err instanceof Error
        ? err.message
        : "Scan failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/** GET — the caller's recent gapper scans. */
export async function GET(req: NextRequest) {
  ensureScannerScheduler();
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const runs = (await storeList<ScanRun>("scan-runs.json"))
    .filter((r) => r.ownerUid === uid && r.kind === "gappers")
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt))
    .slice(0, 10);
  return NextResponse.json({ data: { runs } });
}
