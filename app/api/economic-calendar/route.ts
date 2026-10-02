import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";

export interface EconEvent {
  title: string;
  currency: string;
  /** MM-DD-YYYY */
  date: string;
  /** e.g. "11:50pm" — ForexFactory feed is US Eastern time. */
  time: string;
  impact: "High" | "Medium" | "Low" | "Holiday" | string;
  forecast: string;
  previous: string;
  url: string;
}

function field(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`),
  );
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

/**
 * This week's ForexFactory economic calendar (faireconomy mirror feed —
 * public, no key required). Times are US Eastern.
 */
export async function GET() {
  try {
    const res = await fetch(FEED_URL, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Calendar feed error ${res.status}` }, { status: 502 });
    }
    const xml = await res.text();
    const events: EconEvent[] = [];
    for (const m of xml.matchAll(/<event>([\s\S]*?)<\/event>/g)) {
      const b = m[1];
      events.push({
        title: field(b, "title"),
        currency: field(b, "country"),
        date: field(b, "date"),
        time: field(b, "time"),
        impact: field(b, "impact") || "Low",
        forecast: field(b, "forecast"),
        previous: field(b, "previous"),
        url: field(b, "url"),
      });
    }
    return NextResponse.json({ data: { events } });
  } catch (err) {
    console.error("economic-calendar failed:", err);
    const isNetwork = err instanceof TypeError || (err instanceof Error && err.name === "TimeoutError");
    return NextResponse.json(
      { error: isNetwork ? "Cannot reach the calendar feed — check network and retry" : "Failed to load calendar" },
      { status: 500 },
    );
  }
}
