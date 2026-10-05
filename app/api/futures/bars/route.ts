import { NextRequest, NextResponse } from "next/server";
import {
  PX_BAR_UNIT,
  projectxBars,
  resolveFrontContract,
  userCredsFor,
} from "@/lib/platforms/projectx";
import { verifyUser } from "@/lib/server-auth";
import { TIMEFRAMES, TIMEFRAME_SECONDS, type Timeframe } from "@/lib/timeframe";

const TF_UNIT: Record<Timeframe, { unit: number; n: number }> = {
  "1m": { unit: PX_BAR_UNIT.Minute, n: 1 },
  "5m": { unit: PX_BAR_UNIT.Minute, n: 5 },
  "15m": { unit: PX_BAR_UNIT.Minute, n: 15 },
  "1h": { unit: PX_BAR_UNIT.Hour, n: 1 },
  "4h": { unit: PX_BAR_UNIT.Hour, n: 4 },
  "1d": { unit: PX_BAR_UNIT.Day, n: 1 },
};

const BAR_LIMIT = 300;

/**
 * GET ?symbol=NQ&tf=1m[&platform=topstep|apex]
 * Historical candles for a futures root, resolved to the front-month
 * contract on the caller's linked TopStep/Apex account (env fallback).
 */
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const tf = (req.nextUrl.searchParams.get("tf") ?? "1m") as Timeframe;
  const platform = req.nextUrl.searchParams.get("platform") ?? "topstep";
  if (!symbol || !TIMEFRAMES.includes(tf)) {
    return NextResponse.json({ error: "symbol + valid tf required" }, { status: 400 });
  }
  try {
    const resolved = await userCredsFor(platform, await verifyUser(req));
    if (!resolved) {
      return NextResponse.json(
        { error: `No ${platform} account linked to your login — add one in Admin` },
        { status: 400 },
      );
    }
    const { unit, n } = TF_UNIT[tf];
    const contract = await resolveFrontContract(resolved.creds, symbol);
    const lookback = BAR_LIMIT * TIMEFRAME_SECONDS[tf] * 1000 * 1.6;
    const bars = await projectxBars(
      resolved.creds,
      contract.id,
      unit,
      n,
      lookback,
      BAR_LIMIT,
    );
    const candles = bars
      .map((b) => ({
        time: Math.floor(new Date(b.t).getTime() / 1000),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }))
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);
    return NextResponse.json({
      data: { contractId: contract.id, contractName: contract.name, candles },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bars request failed" },
      { status: 502 },
    );
  }
}
