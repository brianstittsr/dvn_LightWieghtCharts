import type { Candle } from "@/lib/types";

/** A configurable indicator parameter (rendered as an input in the settings UI). */
export interface ParamDef {
  key: string;
  label: string;
  type: "number" | "color" | "source" | "boolean";
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
}

export type ParamValues = Record<string, number | string>;

/** One output series of an indicator (a line, or one band of a channel). */
export interface IndicatorSeries {
  key: string;
  label: string;
  color: string;
  /** Same length alignment as input candles; null = no value at that time. */
  values: { time: number; value: number | null }[];
}

/** A horizontal level an indicator exposes for alerting (e.g. session high/low). */
export interface IndicatorLevel {
  key: string;
  label: string;
  price: number;
  /** "above" = reversal alert when price sweeps above then closes back below. */
  side: "above" | "below";
}

/** A shaded session box: time range × price range with a label. */
export interface IndicatorBox {
  key: string;
  label: string;
  t1: number; // unix seconds
  t2: number;
  high: number;
  low: number;
  color: string;
}

/** A computed indicator ready to render on the chart. */
export interface IndicatorOutput {
  series: IndicatorSeries[];
  /** Optional alertable levels (latest values only). */
  levels?: IndicatorLevel[];
  /** Optional shaded boxes drawn by the chart overlay. */
  boxes?: IndicatorBox[];
}

/** Indicator definition — builtin or AI-generated. */
export interface IndicatorDef {
  id: string;
  name: string;
  params: ParamDef[];
  compute: (candles: Candle[], params: ParamValues) => IndicatorOutput;
  /** Chart pane index — 0 (default) overlays price; 1 renders in a sub-pane below. */
  pane?: number;
  /** True for AI-generated indicators evaluated from source code. */
  custom?: boolean;
  /** Source code for custom indicators (so they can be re-created after reload). */
  code?: string;
}

/** An indicator instance attached to a pane. */
export interface IndicatorInstance {
  /** `${defId}` for builtins or `custom:${id}` for AI indicators. */
  defId: string;
  params: ParamValues;
}
