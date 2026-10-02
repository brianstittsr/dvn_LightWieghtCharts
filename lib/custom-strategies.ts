"use client";

import type { ParamDef } from "@/lib/indicators/types";

const STORAGE_KEY = "lwc-custom-strategies";
const EMPTY: CustomStrategySpec[] = [];

export interface CustomStrategySpec {
  id: string;
  name: string;
  description?: string;
  params: ParamDef[];
  code: string;
}

function read(): CustomStrategySpec[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomStrategySpec[]) : [];
  } catch {
    return [];
  }
}

let cached: CustomStrategySpec[] | null = null;
const listeners = new Set<() => void>();

/** useSyncExternalStore hooks — hydration-safe, notified on save/delete. */
export function subscribeCustomStrategies(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCustomStrategies(): CustomStrategySpec[] {
  if (cached === null) cached = read();
  return cached;
}

export function getServerCustomStrategies(): CustomStrategySpec[] {
  return EMPTY;
}

export function saveCustomStrategy(spec: CustomStrategySpec): void {
  const next = [...getCustomStrategies().filter((s) => s.id !== spec.id), spec];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  cached = next;
  listeners.forEach((l) => l());
}

export function deleteCustomStrategy(id: string): void {
  const next = getCustomStrategies().filter((s) => s.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  cached = next;
  listeners.forEach((l) => l());
}
