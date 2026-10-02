"use client";

import type { Candle } from "@/lib/types";
import type { IndicatorDef, IndicatorSeries, ParamDef, ParamValues } from "./types";
import { BUILTIN_INDICATORS } from "./builtin";

const STORAGE_KEY = "lwc-custom-indicators";

/** Helpers injected into AI-generated indicator code. */
const helpers = {
  sma(vals: number[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(vals.length).fill(null);
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= period) sum -= vals[i - period];
      if (i + 1 >= period) out[i] = sum / period;
    }
    return out;
  },
  ema(vals: number[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(vals.length).fill(null);
    const k = 2 / (period + 1);
    let e: number | null = null;
    for (let i = 0; i < vals.length; i++) {
      e = e == null ? vals[i] : vals[i] * k + e * (1 - k);
      if (i + 1 >= period) out[i] = e;
    }
    return out;
  },
};

export interface CustomIndicatorSpec {
  id: string;
  name: string;
  params: ParamDef[];
  code: string;
}

function toDef(spec: CustomIndicatorSpec): IndicatorDef {
  return {
    id: `custom:${spec.id}`,
    name: spec.name,
    params: spec.params,
    custom: true,
    code: spec.code,
    compute(candles: Candle[], params: ParamValues) {
      const make = (body: string) =>
        (new Function("candles", "params", "helpers", body) as (
          c: Candle[],
          p: ParamValues,
          h: typeof helpers,
        ) => IndicatorSeries[] | undefined)(candles, params, helpers);
      // Primary contract: the body returns the series array. Some models wrap
      // the logic in `function fn(...)` instead — call it if nothing returned.
      let series = make(spec.code);
      if (series === undefined) {
        series = make(
          `${spec.code}\n; if (typeof fn === 'function') return fn(candles, params, helpers);`,
        );
      }
      if (!Array.isArray(series)) throw new Error("Custom indicator must return an array of series");
      return { series };
    },
  };
}

export function loadCustomIndicators(): IndicatorDef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const specs = raw ? (JSON.parse(raw) as CustomIndicatorSpec[]) : [];
    return specs.map(toDef);
  } catch {
    return [];
  }
}

export function saveCustomIndicator(spec: CustomIndicatorSpec): IndicatorDef {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const specs = raw ? (JSON.parse(raw) as CustomIndicatorSpec[]) : [];
  const next = [...specs.filter((s) => s.id !== spec.id), spec];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return toDef(spec);
}

export function deleteCustomIndicator(id: string): void {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const specs = raw ? (JSON.parse(raw) as CustomIndicatorSpec[]) : [];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(specs.filter((s) => s.id !== id)));
}

/** Registry lookup: builtins + persisted AI indicators. */
export function getIndicatorDef(defId: string): IndicatorDef | undefined {
  const builtin = BUILTIN_INDICATORS.find((d) => d.id === defId);
  if (builtin) return builtin;
  if (defId.startsWith("custom:")) {
    return loadCustomIndicators().find((d) => d.id === defId);
  }
  return undefined;
}
