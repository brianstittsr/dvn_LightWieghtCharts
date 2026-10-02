import { NextRequest, NextResponse } from "next/server";
import { credsFor, projectxOpenPositions } from "@/lib/platforms/projectx";

/** GET ?platform=&accountId= — open futures positions. */
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") ?? "";
  const accountId = Number(req.nextUrl.searchParams.get("accountId"));
  const creds = credsFor(platform);
  if (!creds || !Number.isFinite(accountId)) {
    return NextResponse.json({ error: "platform + accountId required" }, { status: 400 });
  }
  try {
    const positions = await projectxOpenPositions(creds, accountId);
    return NextResponse.json({
      data: {
        positions: positions.map((p) => ({
          id: p.id,
          contractId: p.contractId,
          side: p.type === 1 ? "long" : "short",
          size: p.size,
          averagePrice: p.averagePrice,
        })),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Positions failed" },
      { status: 502 },
    );
  }
}
