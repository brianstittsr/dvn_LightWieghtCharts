import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getSettingsDoc, putSettingsDoc } from "@/lib/store";
import { appSettingsSchema, DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings";

/** Public read — settings hold no secrets (credentials live in env/accounts). */
export async function GET() {
  const stored = await getSettingsDoc<Partial<AppSettings>>({});
  const parsed = appSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
  return NextResponse.json({ data: parsed.success ? parsed.data : DEFAULT_SETTINGS });
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const stored = await getSettingsDoc<Partial<AppSettings>>({});
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    ...(body as object),
    backtest: { ...DEFAULT_SETTINGS.backtest, ...stored.backtest, ...(body?.backtest ?? {}) },
    sessions: { ...DEFAULT_SETTINGS.sessions, ...stored.sessions, ...(body?.sessions ?? {}) },
  };
  const parsed = appSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid settings" },
      { status: 400 },
    );
  }
  await putSettingsDoc(parsed.data);
  return NextResponse.json({ data: parsed.data });
}
