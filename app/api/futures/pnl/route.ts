import { NextRequest, NextResponse } from "next/server";
import {
  projectxAccounts,
  projectxContractById,
  projectxLastPrice,
  projectxOpenPositions,
  projectxToken,
  userCredsFor,
} from "@/lib/platforms/projectx";
import { verifyUser } from "@/lib/server-auth";

/**
 * GET ?platform=topstep|apex — futures account snapshot for the bottom bar:
 * balance, open positions, and unrealized P&L derived from last price vs
 * average price through the contract's tickSize/tickValue.
 */
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") ?? "topstep";
  const resolved = await userCredsFor(platform, await verifyUser(req));
  if (!resolved) {
    return NextResponse.json({ error: `No ${platform} account linked` }, { status: 400 });
  }
  try {
    const creds = resolved.creds;
    const accounts = await projectxAccounts(creds, await projectxToken(creds));
    const accountId = resolved.accountId ?? accounts.find((a) => a.canTrade)?.id;
    if (!accountId) return NextResponse.json({ error: "No tradeable account" }, { status: 400 });
    const acct = accounts.find((a) => a.id === accountId);

    const positions = await projectxOpenPositions(creds, accountId);
    const rows = await Promise.all(
      positions.map(async (p) => {
        const [last, contract] = await Promise.all([
          projectxLastPrice(creds, p.contractId).catch(() => null),
          projectxContractById(creds, p.contractId).catch(() => null),
        ]);
        const pointVal =
          contract && contract.tickSize > 0 ? contract.tickValue / contract.tickSize : 0;
        const dir = p.type === 1 ? 1 : -1;
        const uPnl = last != null ? (last - p.averagePrice) * dir * p.size * pointVal : null;
        return {
          contractId: p.contractId,
          name: contract?.name ?? p.contractId,
          side: p.type === 1 ? "long" : "short",
          size: p.size,
          averagePrice: p.averagePrice,
          last,
          uPnl,
        };
      }),
    );
    const uPnl = rows.every((r) => r.uPnl != null)
      ? rows.reduce((s, r) => s + (r.uPnl ?? 0), 0)
      : null;
    return NextResponse.json({
      data: {
        platform,
        accountId,
        accountName: acct?.name ?? String(accountId),
        balance: acct?.balance ?? null,
        positions: rows,
        uPnl,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Futures P&L failed" },
      { status: 502 },
    );
  }
}
