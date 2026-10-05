import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runBacktest, STRATEGY_PARAMS, type BacktestStrategyId } from "@/lib/backtest";
import { barsRangeFor } from "@/lib/scanner/data";
import { verifyUser } from "@/lib/server-auth";
import type { ParamDef } from "@/lib/indicators/types";

const paramDefSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().max(80),
  type: z.enum(["number", "color", "source", "boolean"]),
  default: z.union([z.number(), z.string()]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

const bodySchema = z.object({
  assetClass: z.enum(["stock", "crypto", "future"]).default("stock"),
  symbol: z.string().min(1).max(15),
  tf: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("15m"),
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  strategy: z.string().min(1).max(60),
  /** For custom:* strategies — code + declared params. */
  customSpec: z
    .object({
      code: z.string().min(1).max(20_000),
      params: z.array(paramDefSchema).max(10),
    })
    .optional(),
  /** Explicit value lists per param key — used for Fin-R1 refined rounds. */
  ranges: z.record(z.string(), z.array(z.number()).min(1).max(8)).optional(),
  config: z
    .object({
      initialCapital: z.number().positive().default(10_000),
      riskPerTrade: z.number().positive().max(50).default(1),
      commission: z.number().min(0).default(1),
      slippagePct: z.number().min(0).max(5).default(0.02),
      longShort: z.boolean().default(true),
    })
    .default({ initialCapital: 10_000, riskPerTrade: 1, commission: 1, slippagePct: 0.02, longShort: true }),
});

const MAX_COMBOS = 200;

/** Build an auto value list for a param: default + spread across [min, max]. */
function autoValues(p: ParamDef): number[] {
  const lo = typeof p.min === "number" ? p.min : 0;
  const hi = typeof p.max === "number" ? p.max : lo * 4 || 10;
  const dflt = typeof p.default === "number" ? p.default : lo;
  const vals = new Set<number>([dflt]);
  for (let i = 0; i <= 3; i++) vals.add(Math.round((lo + ((hi - lo) * i) / 3) * 100) / 100);
  return [...vals].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
}

function gridFrom(
  defs: ParamDef[],
  ranges?: Record<string, number[]>,
): Record<string, number>[] {
  const keys = defs.map((d) => d.key);
  const lists = defs.map((d) => ranges?.[d.key]?.length ? ranges[d.key] : autoValues(d));
  const combos: Record<string, number>[] = [];
  const walk = (i: number, acc: Record<string, number>) => {
    if (combos.length >= MAX_COMBOS) return;
    if (i === keys.length) {
      combos.push({ ...acc });
      return;
    }
    for (const v of lists[i]) {
      acc[keys[i]] = v;
      walk(i + 1, acc);
      if (combos.length >= MAX_COMBOS) return;
    }
  };
  walk(0, {});
  return combos;
}

/**
 * Composite ranking score: net return minus a drawdown penalty, halved when
 * the run produced too few trades to trust.
 */
function score(s: { returnPercent: number; maxDrawdownPercent: number; totalTrades: number }): number {
  const raw = s.returnPercent - 0.5 * s.maxDrawdownPercent;
  return s.totalTrades < 3 ? raw / 2 : raw;
}

/** POST — grid-search strategy params over a user-defined period. */
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;
  if (b.from >= b.to) return NextResponse.json({ error: "`from` must be before `to`" }, { status: 400 });

  const isCustom = b.strategy.startsWith("custom:");
  const defs: ParamDef[] = isCustom
    ? (b.customSpec?.params ?? [])
    : (STRATEGY_PARAMS[b.strategy as BacktestStrategyId] ?? []);
  if (isCustom && !b.customSpec) {
    return NextResponse.json({ error: "customSpec required for custom strategies" }, { status: 400 });
  }
  if (!defs.length) {
    return NextResponse.json({ error: "Strategy has no optimizable parameters" }, { status: 400 });
  }

  let candles;
  try {
    candles = await barsRangeFor(b.assetClass, b.symbol, b.tf, b.from, b.to, uid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
  }
  if (candles.length < 50) {
    return NextResponse.json(
      { error: `Only ${candles.length} bars in that range — widen the dates or lower the timeframe` },
      { status: 400 },
    );
  }

  const combos = gridFrom(defs, b.ranges);
  const cfg = {
    strategy: b.strategy,
    initialCapital: b.config.initialCapital,
    riskPerTrade: b.config.riskPerTrade,
    commission: b.config.commission,
    slippagePct: b.config.slippagePct,
    longShort: b.config.longShort,
  };

  const runs = combos.map((params) => {
    try {
      const r = runBacktest(
        candles,
        cfg,
        b.symbol,
        b.tf,
        { code: b.customSpec?.code ?? "", params },
      );
      const s = r.summary;
      return {
        params,
        returnPercent: s.returnPercent,
        profitFactor: s.profitFactor,
        maxDrawdownPercent: s.maxDrawdownPercent,
        winRate: s.winRate,
        totalTrades: s.totalTrades,
        avgWin: s.avgWin,
        avgLoss: s.avgLoss,
        score: score(s),
      };
    } catch {
      return null;
    }
  });

  const valid = runs.filter((r): r is NonNullable<typeof r> => r !== null);
  valid.sort((a, z) => z.score - a.score);
  const top = valid.slice(0, 15);

  return NextResponse.json({
    symbol: b.symbol,
    assetClass: b.assetClass,
    tf: b.tf,
    bars: candles.length,
    combos: combos.length,
    from: b.from,
    to: b.to,
    strategy: b.strategy,
    paramKeys: defs.map((d) => d.key),
    top,
    worst: valid.length ? valid[valid.length - 1] : null,
  });
}
