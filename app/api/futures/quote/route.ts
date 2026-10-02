import { NextRequest, NextResponse } from "next/server";
import { credsFor, projectxLastPrice } from "@/lib/platforms/projectx";

/**
 * GET ?platform=topstep|apex&contractId=CON.F.US.EP.Z25
 * ProjectX streams quotes over SignalR only — REST gives last price via the
 * most recent 1m bar, so bid/ask are reported as unavailable.
 */
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") ?? "";
  const contractId = req.nextUrl.searchParams.get("contractId") ?? "";
  const creds = credsFor(platform);
  if (!creds || !contractId) {
    return NextResponse.json({ error: "platform + contractId required" }, { status: 400 });
  }
  try {
    const last = await projectxLastPrice(creds, contractId);
    return NextResponse.json({ data: { last, bid: null, ask: null } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Quote failed" },
      { status: 502 },
    );
  }
}
