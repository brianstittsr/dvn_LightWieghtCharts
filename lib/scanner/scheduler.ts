/**
 * Scanner scheduler — in-process ticks (like the bot engine) that fire saved
 * ScannerConfigs inside their ET windows, persist ScanRuns, and send gated
 * Telegram notifications.
 *
 * Catch-up: a config that missed its slot while the server was down fires on
 * the first tick inside the window (article's launchd catch-up equivalent).
 * On Vercel the tick also runs via /api/scanner/tick (vercel.json cron).
 */
import { randomUUID } from "crypto";
import { sendTelegram } from "@/lib/notify";
import { runGappersScan } from "@/lib/scanner/gappers";
import { runSetupScan } from "@/lib/scanner/setup";
import {
  etNow,
  type EtNow,
  type ScanRun,
  type ScannerConfig,
} from "@/lib/scanner/types";
import { storeList, storePut } from "@/lib/store";

const TICK_MS = 60_000;
const MAX_RUNS_PER_OWNER = 50;

let timer: NodeJS.Timeout | null = null;
const inFlight = new Set<string>();

/** Format ET minutes → "HH:MM". */
const etClock = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Slot identifier for "has this config already fired for this period?". */
function slotKey(cfg: ScannerConfig, et: EtNow): string {
  const slot = Math.floor(et.minutes / Math.max(1, cfg.schedule.intervalMin));
  return `${et.dateKey}#${slot}`;
}

function due(cfg: ScannerConfig, et: EtNow): boolean {
  const s = cfg.schedule;
  if (!s.enabled) return false;
  if (s.weekdaysOnly && (et.weekday === 0 || et.weekday === 6)) return false;
  if (et.minutes < s.windowStartEt || et.minutes > s.windowEndEt) return false;
  return cfg.lastSlotKey !== slotKey(cfg, et);
}

// ── Scan execution ────────────────────────────────────────────────────────────

/** Run one config end-to-end: scan → persist run → gated notification. */
export async function runScannerConfig(
  cfg: ScannerConfig,
  opts: { notify?: boolean } = {},
): Promise<ScanRun> {
  const run: ScanRun = {
    id: randomUUID(),
    kind: cfg.kind,
    ownerUid: cfg.ownerUid,
    configId: cfg.id,
    ranAt: new Date().toISOString(),
  };
  try {
    if (cfg.kind === "gappers") {
      run.gappers = await runGappersScan(
        cfg.filters ?? {
          minGapPct: 5,
          minPrice: 3,
          minPremarketVolume: 50_000,
          topN: 10,
        },
      );
    } else {
      run.setups = await runSetupScan(cfg.universe ?? [], {
        id: cfg.strategyId ?? "trend-join-long",
        code: cfg.strategyCode,
        params: cfg.strategyParams,
      });
    }
  } catch (err) {
    run.error = err instanceof Error ? err.message : "scan failed";
  }
  await storePut("scan-runs.json", run);
  await pruneRuns(cfg.ownerUid);
  if (opts.notify) await maybeNotify(cfg, run);
  return run;
}

async function pruneRuns(ownerUid: string): Promise<void> {
  const runs = (await storeList<ScanRun>("scan-runs.json"))
    .filter((r) => r.ownerUid === ownerUid)
    .sort((a, b) => a.ranAt.localeCompare(b.ranAt));
  const excess = runs.length - MAX_RUNS_PER_OWNER;
  if (excess <= 0) return;
  const { storeDelete } = await import("@/lib/store");
  for (const r of runs.slice(0, excess)) {
    await storeDelete("scan-runs.json", r.id).catch(() => {});
  }
}

// ── Notification gating ───────────────────────────────────────────────────────

function messageFor(cfg: ScannerConfig, run: ScanRun, et: EtNow): string | null {
  if (run.error) return `⚠️ *${cfg.name}* — scan error\n${run.error}`;
  if (cfg.kind === "gappers") {
    const g = run.gappers ?? [];
    if (g.length === 0) return null;
    const lines = g.map(
      (x) =>
        `• ${x.symbol} $${x.price.toFixed(2)} +${x.gapPct.toFixed(1)}%` +
        (x.catalyst ? ` — ${x.catalyst}` : ""),
    );
    return `📊 *Premarket Gappers* — ${et.dateKey}\n${lines.join("\n")}`;
  }
  const hits = (run.setups ?? []).filter((s) => s.result === "PASS");
  if (hits.length === 0) return null;
  const lines = hits.map((h) => {
    const lv =
      h.pmh != null && h.prevDailyHigh != null && h.sma200 != null
        ? ` (PMH ${h.pmh.toFixed(2)}, prev high ${h.prevDailyHigh.toFixed(2)}, SMA200 ${h.sma200.toFixed(2)})`
        : "";
    return `• ${h.symbol} @ $${(h.currPrice ?? 0).toFixed(2)}${lv}`;
  });
  return `🎯 *${cfg.name}* — ${etClock(et.minutes)} ET\n${lines.join("\n")}`;
}

async function maybeNotify(cfg: ScannerConfig, run: ScanRun): Promise<void> {
  const et = etNow();
  const msg = messageFor(cfg, run, et);
  // Gating key: errors always notify once each; otherwise first-run-of-day or
  // a changed hit set. Empty scans share the day's key → no repeat pings.
  const hitSet = run.error
    ? `err:${run.error}`
    : cfg.kind === "gappers"
      ? (run.gappers ?? []).map((g) => g.symbol).join(",")
      : (run.setups ?? []).filter((s) => s.result === "PASS").map((s) => s.symbol).join(",");
  const key = `${et.dateKey}::${hitSet}`;
  if (cfg.lastNotifiedKey === key) return;
  if (msg) {
    const sent = await sendTelegram(cfg.ownerUid, msg);
    if (!sent.ok) return; // don't burn the key when delivery failed
  }
  cfg.lastNotifiedKey = key;
  await storePut("scanner-configs.json", cfg);
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

/**
 * Evaluate all enabled configs and fire the ones that are due. Called by the
 * in-process timer, lazily from scanner API routes, and by the cron route.
 */
export async function scannerTick(): Promise<number> {
  const et = etNow();
  const configs = (await storeList<ScannerConfig>("scanner-configs.json")).filter(
    (c) => due(c, et),
  );
  let fired = 0;
  for (const cfg of configs) {
    if (inFlight.has(cfg.id)) continue;
    inFlight.add(cfg.id);
    // Mark the slot consumed before running so a slow scan can't double-fire.
    cfg.lastSlotKey = slotKey(cfg, et);
    await storePut("scanner-configs.json", cfg);
    runScannerConfig(cfg, { notify: true })
      .catch(() => {})
      .finally(() => inFlight.delete(cfg.id));
    fired += 1;
  }
  return fired;
}

/** Start the 60s in-process tick (idempotent). Safe on serverless — no-ops
 *  are cheap; Vercel scheduling rides on /api/scanner/tick instead. */
export function ensureScannerScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    scannerTick().catch(() => {});
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  scannerTick().catch(() => {});
}
