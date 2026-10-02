"use client";

import { useSyncExternalStore } from "react";
import type { AlpacaPosition } from "@/app/api/alpaca/positions/route";

/**
 * Shared Alpaca positions poller — one 15s interval serves every pane and the
 * positions bar instead of each component polling independently.
 */

const DEFAULT_POLL_MS = 15_000;
const EMPTY: AlpacaPosition[] = [];

let positions: AlpacaPosition[] = EMPTY;
let pollMs = DEFAULT_POLL_MS;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
const listeners = new Set<() => void>();

/** Pull the admin-configured poll interval once, then use it for the interval. */
function startPolling(): void {
  void poll();
  timer = setInterval(poll, pollMs);
  fetch("/api/settings")
    .then((r) => r.json())
    .then((d: { data?: { positionPollMs?: number } }) => {
      const ms = d.data?.positionPollMs;
      if (typeof ms === "number" && ms >= 3000 && ms <= 120000 && ms !== pollMs) {
        pollMs = ms;
        if (timer) {
          clearInterval(timer);
          timer = setInterval(poll, pollMs);
        }
      }
    })
    .catch(() => {});
}

async function poll(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const res = await fetch("/api/alpaca/positions");
    const body = (await res.json()) as { data?: AlpacaPosition[] };
    if (body.data) {
      positions = body.data;
      listeners.forEach((fn) => fn());
    }
  } catch {
    /* keep last known state */
  } finally {
    inflight = false;
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) {
    startPolling();
    window.addEventListener("alpaca-orders-changed", poll);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      window.removeEventListener("alpaca-orders-changed", poll);
    }
  };
}

export function useAlpacaPositions(): AlpacaPosition[] {
  return useSyncExternalStore(subscribe, () => positions, () => EMPTY);
}
