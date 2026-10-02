"use client";

/** localStorage-backed set of dates that have a saved P&L day journal. */

export const JOURNAL_PREFIX = "pnl-journal:";

const EMPTY = new Set<string>();
let cache: Set<string> | null = null;
const listeners = new Set<() => void>();

function scan(): Set<string> {
  const found = new Set<string>();
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(JOURNAL_PREFIX)) found.add(k.slice(JOURNAL_PREFIX.length));
    }
  } catch {
    /* storage unavailable */
  }
  return found;
}

export function subscribeJournals(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getJournaledDates(): Set<string> {
  if (cache === null) cache = scan();
  return cache;
}

export function getServerJournaledDates(): Set<string> {
  return EMPTY;
}

export function markJournaled(date: string): void {
  const next = new Set(getJournaledDates());
  next.add(date);
  cache = next;
  listeners.forEach((l) => l());
}
