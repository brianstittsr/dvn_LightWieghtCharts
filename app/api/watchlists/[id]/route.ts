import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Watchlist } from "@/lib/scanner/types";
import { verifyUser } from "@/lib/server-auth";
import { storeDelete, storeList, storePut } from "@/lib/store";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  symbols: z.array(z.string().trim().min(1).max(15)).min(1).max(100).optional(),
});

async function owned(
  req: NextRequest,
  id: string,
): Promise<{ uid: string; wl?: Watchlist } | NextResponse> {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const wl = (await storeList<Watchlist>("watchlists.json")).find(
    (w) => w.id === id,
  );
  if (!wl || wl.uid !== uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return { uid, wl };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const o = await owned(req, id);
  if (o instanceof NextResponse) return o;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const wl: Watchlist = {
    ...o.wl!,
    ...parsed.data,
    symbols: parsed.data.symbols
      ? [...new Set(parsed.data.symbols.map((s) => s.toUpperCase()))]
      : o.wl!.symbols,
    updatedAt: new Date().toISOString(),
  };
  await storePut("watchlists.json", wl);
  return NextResponse.json({ data: { watchlist: wl } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const o = await owned(req, id);
  if (o instanceof NextResponse) return o;
  await storeDelete("watchlists.json", id);
  return NextResponse.json({ data: { deleted: true } });
}
