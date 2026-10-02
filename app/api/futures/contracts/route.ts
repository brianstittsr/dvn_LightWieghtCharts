import { NextRequest, NextResponse } from "next/server";
import { credsFor, projectxContracts } from "@/lib/platforms/projectx";

/** GET ?platform=topstep|apex&q=ES — contract search. */
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") ?? "";
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const creds = credsFor(platform);
  if (!creds) {
    return NextResponse.json(
      { error: `Platform "${platform}" is not configured` },
      { status: 400 },
    );
  }
  try {
    const contracts = await projectxContracts(creds, q);
    return NextResponse.json({
      data: {
        contracts: contracts.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          symbolId: c.symbolId,
          tickSize: c.tickSize,
          tickValue: c.tickValue,
        })),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Contract search failed" },
      { status: 502 },
    );
  }
}
