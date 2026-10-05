import { NextRequest, NextResponse } from "next/server";
import {
  projectxOpenPositions,
  resolveFrontContract,
  userCredsFor,
} from "@/lib/platforms/projectx";
import { verifyUser } from "@/lib/server-auth";

/** GET ?platform=&accountId=&symbol= — open futures positions. accountId may be
 *  omitted when the linked account record pins one. When `symbol` (a contract
 *  root like NQ or MES) is given, returns only the net position on that root's
 *  front contract — for the chart header's open-contracts badge. */
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") ?? "";
  const root = req.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "";
  const resolved = await userCredsFor(platform, await verifyUser(req));
  const accountId =
    Number(req.nextUrl.searchParams.get("accountId")) || resolved?.accountId;
  if (!resolved || !accountId) {
    return NextResponse.json({ error: "platform + accountId required" }, { status: 400 });
  }
  try {
    const positions = await projectxOpenPositions(resolved.creds, accountId);
    const mapped = positions.map((p) => ({
      id: p.id,
      contractId: p.contractId,
      side: p.type === 1 ? "long" : "short",
      size: p.size,
      averagePrice: p.averagePrice,
    }));
    if (root) {
      const front = await resolveFrontContract(resolved.creds, root);
      const position = mapped.find((p) => p.contractId === front.id) ?? null;
      return NextResponse.json({ data: { position, contractId: front.id } });
    }
    return NextResponse.json({ data: { positions: mapped } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Positions failed" },
      { status: 502 },
    );
  }
}
