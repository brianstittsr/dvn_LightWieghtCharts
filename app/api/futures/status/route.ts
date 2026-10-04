import { NextRequest, NextResponse } from "next/server";
import {
  FUTURES_PLATFORMS,
  projectxAccounts,
  projectxToken,
  userCredsFor,
} from "@/lib/platforms/projectx";
import { verifyUser } from "@/lib/server-auth";

/** Which futures platforms are configured + their tradeable accounts. */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const platforms = await Promise.all(
    FUTURES_PLATFORMS.map(async (id) => {
      const resolved = await userCredsFor(id, uid);
      if (!resolved) return { id, configured: false, accounts: [] };
      try {
        const token = await projectxToken(resolved.creds);
        const accounts = (await projectxAccounts(resolved.creds, token))
          .filter((a) => a.canTrade)
          .map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
        return {
          id,
          configured: true,
          accounts,
          linkedAccountId: resolved.accountId,
        };
      } catch (e) {
        return {
          id,
          configured: true,
          accounts: [],
          error: e instanceof Error ? e.message : "Connection failed",
        };
      }
    }),
  );
  return NextResponse.json({ data: { platforms } });
}
