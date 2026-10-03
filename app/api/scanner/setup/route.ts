import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { alpacaConfigured, AlpacaError } from "@/lib/alpaca";
import { ensureScannerScheduler } from "@/lib/scanner/scheduler";
import { runSetupScan } from "@/lib/scanner/setup";
import { watchlistSymbols } from "@/lib/scanner/watchlists";
import type { ScanRun } from "@/lib/scanner/types";
import { verifyUser } from "@/lib/server-auth";
import { storeList, storePut } from "@/lib/store";
import { randomUUID } from "crypto";

const runSchema = z.object({
  assetClass: z.enum(["stock", "crypto", "future"]).default("stock"),
  universe: z.array(z.string().min(1).max(15)).min(1).max(50).optional(),
  watchlistId: z.string().optional(),
  strategyId: z.string().default("trend-join-long"),
  strategyCode: z.string().optional(),
  strategyParams: z.record(z.string(), z.number()).optional(),
});

/** POST — run the setup scan over a symbol universe. */
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
  const parsed = runSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { assetClass, universe, watchlistId, strategyId, strategyCode, strategyParams } =
    parsed.data;
  const wlSymbols = await watchlistSymbols(uid, watchlistId);
  const symbols = [
    ...new Set([...(universe ?? []), ...(wlSymbols ?? [])].map((s) => s.toUpperCase().trim())),
  ];
  if (symbols.length === 0) {
    return NextResponse.json({ error: "universe required" }, { status: 400 });
  }
  try {
    const setups = await runSetupScan(symbols, {
      id: strategyId,
      code: strategyCode,
      params: strategyParams,
    }, { assetClass, uid });
    const run: ScanRun = {
      id: randomUUID(),
      kind: "setup",
      ownerUid: uid,
      assetClass,
      ranAt: new Date().toISOString(),
      setups,
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

/** GET — the caller's recent setup scans. */
export async function GET(req: NextRequest) {
  ensureScannerScheduler();
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const runs = (await storeList<ScanRun>("scan-runs.json"))
    .filter((r) => r.ownerUid === uid && r.kind === "setup")
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt))
    .slice(0, 10);
  return NextResponse.json({ data: { runs } });
}
