import { NextRequest, NextResponse } from "next/server";
import { scannerTick } from "@/lib/scanner/scheduler";

/**
 * Cron entry point — registered in vercel.json. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` automatically for scheduled jobs.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const fired = await scannerTick();
  return NextResponse.json({ data: { fired } });
}
