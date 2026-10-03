import { NextRequest, NextResponse } from "next/server";
import { getBot, listBots } from "@/lib/futures-bots";
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
 * Position monitor for one bot: open position on its contract, last price,
 * tickSize/tickValue (for P&L math), and account balance.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const uid = await verifyUser(req);
  if (!(await listBots(uid)).some((b) => b.id === id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bot = await getBot(id);
  if (!bot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resolved = await userCredsFor(bot.platform, uid);
  const accountId = bot.accountId ?? resolved?.accountId;
  if (!resolved || !accountId) {
    return NextResponse.json(
      { error: "No credentials/account resolved for this bot" },
      { status: 400 },
    );
  }
  try {
    const creds = resolved.creds;
    const [positions, last, contract, accounts] = await Promise.all([
      projectxOpenPositions(creds, accountId),
      projectxLastPrice(creds, bot.contractId).catch(() => null),
      projectxContractById(creds, bot.contractId).catch(() => null),
      projectxAccounts(creds, await projectxToken(creds)).catch(() => []),
    ]);
    const pos = positions.find((p) => p.contractId === bot.contractId) ?? null;
    const balance = accounts.find((a) => a.id === accountId)?.balance ?? null;
    return NextResponse.json({
      data: {
        position: pos
          ? {
              side: pos.type === 1 ? "long" : "short",
              size: pos.size,
              averagePrice: pos.averagePrice,
            }
          : null,
        last,
        tickSize: contract?.tickSize ?? null,
        tickValue: contract?.tickValue ?? null,
        balance,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Position query failed" },
      { status: 502 },
    );
  }
}
