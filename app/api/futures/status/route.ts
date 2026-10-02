import { NextResponse } from "next/server";
import {
  credsFor,
  FUTURES_PLATFORMS,
  projectxAccounts,
  projectxToken,
} from "@/lib/platforms/projectx";

/** Which futures platforms are configured + their tradeable accounts. */
export async function GET() {
  const platforms = await Promise.all(
    FUTURES_PLATFORMS.map(async (id) => {
      const creds = credsFor(id);
      if (!creds) return { id, configured: false, accounts: [] };
      try {
        const token = await projectxToken(creds);
        const accounts = (await projectxAccounts(creds, token))
          .filter((a) => a.canTrade)
          .map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
        return { id, configured: true, accounts };
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
