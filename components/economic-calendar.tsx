"use client";

import { useEffect, useMemo, useState } from "react";
import type { EconEvent } from "@/app/api/economic-calendar/route";

const FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵", AUD: "🇦🇺",
  NZD: "🇳🇿", CAD: "🇨🇦", CHF: "🇨🇭", CNY: "🇨🇳", ALL: "🌐",
};

const IMPACT_STYLE: Record<string, { chip: string; label: string }> = {
  High: { chip: "bg-red-500/80 text-white", label: "High" },
  Medium: { chip: "bg-amber-500/80 text-black", label: "Med" },
  Low: { chip: "bg-yellow-500/70 text-black", label: "Low" },
  Holiday: { chip: "bg-neutral-600 text-neutral-200", label: "Hol" },
};
const impactRank = (i: string): number =>
  i === "High" ? 3 : i === "Medium" ? 2 : i === "Holiday" ? 0 : 1;

/** Feed time "11:50pm" → minutes for sorting; "Tentative"/"" handled. */
function timeMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!m) return 24 * 60;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2]);
}

const WDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Weekly economic calendar (ForexFactory feed, US Eastern times). */
export function EconomicCalendar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<EconEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "med+" | "high">("all");

  useEffect(() => {
    if (!open || events !== null) return;
    let cancelled = false;
    fetch("/api/economic-calendar")
      .then(async (r) => {
        const b = (await r.json()) as { data?: { events: EconEvent[] }; error?: string };
        if (!r.ok || !b.data) throw new Error(b.error ?? "Failed to load");
        if (!cancelled) setEvents(b.data.events);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load calendar");
      });
    return () => {
      cancelled = true;
    };
  }, [open, events]);

  const days = useMemo(() => {
    const filtered = (events ?? []).filter((e) =>
      filter === "high" ? e.impact === "High" : filter === "med+" ? impactRank(e.impact) >= 2 : true,
    );
    const map = new Map<string, EconEvent[]>();
    for (const e of filtered) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    const toDate = (s: string): number => {
      const [mm, dd, yyyy] = s.split("-").map(Number);
      return new Date(yyyy, mm - 1, dd).getTime();
    };
    return [...map.entries()]
      .sort(([a], [b]) => toDate(a) - toDate(b))
      .map(([date, evs]) => {
        const [mm, dd, yyyy] = date.split("-").map(Number);
        const d = new Date(yyyy, mm - 1, dd);
        return {
          date,
          label: `${WDAYS[d.getDay()]} ${date}`,
          events: [...evs].sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time)),
        };
      });
  }, [events, filter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-neutral-800 bg-[#0d0f13] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-800 bg-[#0d0f13] px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-neutral-100">Economic Calendar</h2>
            <p className="text-[10px] text-neutral-500">This week · times in US Eastern · ForexFactory</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded bg-neutral-800 px-2 py-1 text-[10px] text-neutral-200 outline-none"
            >
              <option value="all">All events</option>
              <option value="med+">Medium + High</option>
              <option value="high">High impact only</option>
            </select>
            <button onClick={onClose} className="text-xl text-neutral-500 hover:text-neutral-200" aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="px-4 pb-4">
          {error && <div className="mt-3 rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
          {!events && !error && <div className="py-16 text-center text-xs text-neutral-500">Loading calendar…</div>}
          {events && days.length === 0 && (
            <div className="py-16 text-center text-xs text-neutral-500">No events match this filter.</div>
          )}

          {days.map((day) => (
            <div key={day.date} className="mt-3">
              <div className="rounded bg-neutral-800/80 px-3 py-1.5 text-[11px] font-bold text-neutral-200">
                📅 {day.label}
              </div>
              <div className="divide-y divide-neutral-800/60">
                {day.events.map((e, i) => {
                  const imp = IMPACT_STYLE[e.impact] ?? IMPACT_STYLE.Low;
                  return (
                    <a
                      key={i}
                      href={e.url || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-800/40"
                    >
                      <span className="w-5 text-center text-sm leading-none">
                        {FLAGS[e.currency] ?? "🏳️"}
                      </span>
                      <span className="w-9 font-mono text-[10px] font-semibold text-neutral-300">
                        {e.currency}
                      </span>
                      <span className="w-14 font-mono text-[10px] text-neutral-400">
                        {e.time || "—"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-200" title={e.title}>
                        {e.title}
                      </span>
                      <span className="hidden w-12 truncate text-right font-mono text-[10px] text-green-400 sm:block" title="Forecast">
                        {e.forecast}
                      </span>
                      <span className="hidden w-12 truncate text-right font-mono text-[10px] text-neutral-500 sm:block" title="Previous">
                        {e.previous}
                      </span>
                      <span className={`w-9 rounded px-1 py-0.5 text-center text-[9px] font-bold ${imp.chip}`}>
                        {imp.label}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
