import { NextRequest, NextResponse } from "next/server";
import {
  projectxLastBar,
  resolveFrontContract,
  userCredsFor,
} from "@/lib/platforms/projectx";
import { verifyUser } from "@/lib/server-auth";

/**
 * GET ?platform=topstep|apex&contractId=CON.F.US.EP.Z25
 *   or ?platform=topstep|apex&symbol=NQ  (resolves to front month)
 * ProjectX streams quotes over SignalR only — REST gives last price via the
 * most recent 1m bar, so bid/ask are reported as unavailable.
 */
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") ?? "";
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  let contractId = req.nextUrl.searchParams.get("contractId") ?? "";
  const resolved = await userCredsFor(platform, await verifyUser(req));
  if (!resolved || (!contractId && !symbol)) {
    return NextResponse.json(
      { error: "platform + contractId (or symbol) required" },
      { status: 400 },
    );
  }
  try {
    if (!contractId) {
      contractId = (await resolveFrontContract(resolved.creds, symbol)).id;
    }
    const bar = await projectxLastBar(resolved.creds, contractId);
    return NextResponse.json({
      data: {
        last: bar?.c ?? null,
        barTime: bar ? Math.floor(new Date(bar.t).getTime() / 1000) : null,
        bid: null,
        ask: null,
        contractId,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Quote failed" },
      { status: 502 },
    );
  }
}
