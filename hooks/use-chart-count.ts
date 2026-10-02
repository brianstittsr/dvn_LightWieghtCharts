"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "lwc-chart-count";
const DEFAULT_COUNT = 4;
export const CHART_COUNTS = [1, 2, 4, 6, 8] as const;
export const MAX_CHARTS = 8;

function readStoredCount(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  return (CHART_COUNTS as readonly number[]).includes(n) ? n : DEFAULT_COUNT;
}

// Re-render subscribers when the count changes in another tab.
function subscribe(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/** Number of visible chart panes, persisted across reloads. */
export function useChartCount(): [number, (n: number) => void] {
  const count = useSyncExternalStore(subscribe, readStoredCount, () => DEFAULT_COUNT);

  const set = useCallback((n: number) => {
    const clamped = Math.min(Math.max(n, 1), MAX_CHARTS);
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
    // useSyncExternalStore won't see same-tab writes; force a storage event read.
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  return [count, set];
}
