"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { IndicatorBox } from "@/lib/indicators/types";
import type { Candle } from "@/lib/types";
import { cn } from "@/lib/utils";

type Drawing =
  | { kind: "hline"; price: number; color: string }
  | { kind: "tp"; price: number; color: string }
  | { kind: "sl"; price: number; color: string }
  | { kind: "trend"; t1: number; p1: number; t2: number; p2: number; color: string }
  | { kind: "rect"; t1: number; p1: number; t2: number; p2: number; color: string };

type Tool = "cursor" | "hline" | "trend" | "rect" | "eraser" | "anchor" | "tp" | "sl";

/** TP/SL levels drawn on the chart, reported to the pane for cross alerts. */
export interface TpSlLevel {
  kind: "tp" | "sl";
  price: number;
}

interface DrawingLayerProps {
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<"Candlestick"> | null;
  storageKey: string;
  /** Indicator-produced shaded boxes (e.g. session ranges), read each frame. */
  getBoxes?: () => IndicatorBox[];
  /** Loaded candles (ascending times) used to snap box edges to real bars. */
  getCandles?: () => Candle[];
  /** Called with the clicked candle time when the ⚓ anchor tool is used. */
  onAnchorClick?: (t: number) => void;
  /** Called whenever drawn TP/SL levels change. */
  onLevels?: (levels: TpSlLevel[]) => void;
}

const TP_COLOR = "#22c55e";
const SL_COLOR = "#ef4444";

const EMPTY_BOXES: IndicatorBox[] = [];
const EMPTY_CANDLES: Candle[] = [];

/** Largest index with time <= t, or -1. */
function lastIdxAtOrBefore(times: Candle[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Smallest index with time >= t, or -1. */
function firstIdxAtOrAfter(times: Candle[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid].time >= t) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

const DRAW_COLOR = "#f59e0b";
const HIT_PX = 8;

function storageLoad(key: string): Drawing[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Drawing[]) : [];
  } catch {
    return [];
  }
}

/** Canvas overlay providing trendline / horizontal-line / rectangle drawing. */
export function DrawingLayer({ getChart, getSeries, storageKey, getBoxes, getCandles, onAnchorClick, onLevels }: DrawingLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("cursor");
  // Start empty: localStorage is read in the effect below so SSR markup matches.
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const anchorRef = useRef<{ t: number; p: number } | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const drawingsRef = useRef(drawings);

  // Reload drawings when the storage key (pane+symbol) changes.
  useEffect(() => {
    const id = setTimeout(() => {
      anchorRef.current = null;
      const loaded = storageLoad(storageKey);
      drawingsRef.current = loaded;
      setDrawings(loaded);
      onLevels?.(
        loaded
          .filter((d): d is { kind: "tp" | "sl"; price: number; color: string } => d.kind === "tp" || d.kind === "sl")
          .map((d) => ({ kind: d.kind, price: d.price })),
      );
    }, 0);
    return () => clearTimeout(id);
  }, [storageKey, onLevels]);

  const persistDrawings = useCallback(
    (next: Drawing[]) => {
      drawingsRef.current = next;
      setDrawings(next);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      onLevels?.(
        next
          .filter((d): d is { kind: "tp" | "sl"; price: number; color: string } => d.kind === "tp" || d.kind === "sl")
          .map((d) => ({ kind: d.kind, price: d.price })),
      );
    },
    [storageKey, onLevels],
  );

  // Keep the canvas sized to its container (HiDPI aware).
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  /** Coordinate converters between (time,price) and canvas pixels. */
  const toXY = useCallback(
    (t: number, p: number): { x: number; y: number } | null => {
      const chart = getChart();
      const series = getSeries();
      if (!chart || !series) return null;
      const x = chart.timeScale().timeToCoordinate(t as UTCTimestamp);
      const y = series.priceToCoordinate(p);
      if (x == null || y == null) return null;
      return { x, y };
    },
    [getChart, getSeries],
  );

  const fromXY = useCallback(
    (x: number, y: number): { t: number; p: number } | null => {
      const chart = getChart();
      const series = getSeries();
      if (!chart || !series) return null;
      const t = chart.timeScale().coordinateToTime(x);
      const p = series.coordinateToPrice(y);
      if (t == null || p == null) return null;
      return { t: Number(t), p };
    },
    [getChart, getSeries],
  );

  // Render loop — cheap: clears + redraws a handful of shapes per frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      // Indicator boxes (session ranges) drawn under user drawings.
      const candles = getCandles?.() ?? EMPTY_CANDLES;
      for (const box of getBoxes?.() ?? EMPTY_BOXES) {
        // Session boundaries rarely land on bar times — snap to the first
        // candle >= t1 and the last candle <= t2 so timeToCoordinate works.
        const i1 = firstIdxAtOrAfter(candles, box.t1);
        const i2 = lastIdxAtOrBefore(candles, box.t2);
        if (i1 < 0 || i2 < 0 || i1 > i2) continue;
        const a = toXY(candles[i1].time, box.high);
        const b = toXY(candles[i2].time, box.low);
        if (!a || !b) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx.fillStyle = `${box.color}26`; // ~15% opacity fill
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = box.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(x, y, w, h);
        // Centered label pill.
        ctx.font = "600 10px sans-serif";
        const tw = ctx.measureText(box.label).width;
        const px = x + w / 2 - tw / 2;
        const py = y + h / 2;
        ctx.fillStyle = box.color;
        ctx.fillRect(px - 6, py - 9, tw + 12, 18);
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(box.label, px + tw / 2, py);
      }

      const all = drawingsRef.current.slice();
      // Preview the in-progress shape at the cursor.
      const anchor = anchorRef.current;
      const mouse = mouseRef.current;
      if (anchor && mouse) {
        const m = fromXY(mouse.x, mouse.y);
        if (m) {
          if (tool === "trend") all.push({ kind: "trend", t1: anchor.t, p1: anchor.p, t2: m.t, p2: m.p, color: DRAW_COLOR });
          if (tool === "rect") all.push({ kind: "rect", t1: anchor.t, p1: anchor.p, t2: m.t, p2: m.p, color: DRAW_COLOR });
        }
      }

      for (const d of all) {
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(d.kind === "hline" ? [6, 4] : []);
        ctx.beginPath();
        if (d.kind === "hline" || d.kind === "tp" || d.kind === "sl") {
          const series = getSeries();
          if (!series) break;
          const y = series.priceToCoordinate(d.price);
          if (y == null) continue;
          ctx.setLineDash(d.kind === "hline" ? [6, 4] : [10, 4]);
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width / dpr, y);
          ctx.stroke();
          ctx.beginPath();
          if (d.kind !== "hline") {
            // Label chip: "TP 123.45" / "SL 123.45" on the left edge.
            const label = `${d.kind.toUpperCase()} ${d.price.toFixed(2)}`;
            ctx.font = "600 10px sans-serif";
            const tw = ctx.measureText(label).width;
            ctx.setLineDash([]);
            ctx.fillStyle = d.color;
            ctx.fillRect(4, y - 9, tw + 12, 18);
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(label, 10, y);
          }
        } else {
          const a = toXY(d.t1, d.p1);
          const b = toXY(d.t2, d.p2);
          if (!a || !b) continue;
          if (d.kind === "trend") {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          } else {
            ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
            ctx.beginPath();
          }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tool, getSeries, toXY, fromXY, getBoxes, getCandles]);

  function hitTest(x: number, y: number): number {
    const list = drawingsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (d.kind === "hline" || d.kind === "tp" || d.kind === "sl") {
        const series = getSeries();
        const yy = series?.priceToCoordinate(d.price);
        if (yy != null && Math.abs(y - yy) < HIT_PX) return i;
      } else {
        const a = toXY(d.t1, d.p1);
        const b = toXY(d.t2, d.p2);
        if (!a || !b) continue;
        if (d.kind === "rect") {
          const l = Math.min(a.x, b.x);
          const r = Math.max(a.x, b.x);
          const tp = Math.min(a.y, b.y);
          const bt = Math.max(a.y, b.y);
          const nearEdge =
            x >= l - HIT_PX &&
            x <= r + HIT_PX &&
            y >= tp - HIT_PX &&
            y <= bt + HIT_PX &&
            (Math.abs(x - l) < HIT_PX || Math.abs(x - r) < HIT_PX || Math.abs(y - tp) < HIT_PX || Math.abs(y - bt) < HIT_PX);
          if (nearEdge) return i;
        } else {
          // point-to-segment distance
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
          const px = a.x + t * dx;
          const py = a.y + t * dy;
          if (Math.hypot(x - px, y - py) < HIT_PX) return i;
        }
      }
    }
    return -1;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "cursor") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (tool === "eraser") {
      const i = hitTest(x, y);
      if (i >= 0) persistDrawings(drawingsRef.current.filter((_, j) => j !== i));
      return;
    }
    const pt = fromXY(x, y);
    if (!pt) return;
    if (tool === "anchor") {
      // Snap to the nearest loaded candle so the anchor lands on a real bar.
      const candles = getCandles?.() ?? EMPTY_CANDLES;
      const i = lastIdxAtOrBefore(candles, pt.t);
      if (i >= 0) {
        onAnchorClick?.(candles[i].time);
        setTool("cursor");
      }
      return;
    }
    if (tool === "hline" || tool === "tp" || tool === "sl") {
      const color = tool === "tp" ? TP_COLOR : tool === "sl" ? SL_COLOR : DRAW_COLOR;
      persistDrawings([...drawingsRef.current, { kind: tool, price: pt.p, color }]);
      return;
    }
    // Two-click tools.
    if (!anchorRef.current) {
      anchorRef.current = pt;
    } else {
      const a = anchorRef.current;
      anchorRef.current = null;
      persistDrawings([
        ...drawingsRef.current,
        { kind: tool, t1: a.t, p1: a.p, t2: pt.t, p2: pt.p, color: DRAW_COLOR } as Drawing,
      ]);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const tools: { id: Tool; icon: string; title: string }[] = [
    { id: "cursor", icon: "⬚", title: "Cursor" },
    { id: "hline", icon: "─", title: "Horizontal line (click)" },
    { id: "trend", icon: "╱", title: "Trend line (2 clicks)" },
    { id: "rect", icon: "▭", title: "Rectangle (2 clicks)" },
    { id: "tp", icon: "TP", title: "Take profit line (click)" },
    { id: "sl", icon: "SL", title: "Stop loss line (click)" },
    { id: "eraser", icon: "⌫", title: "Eraser (click a drawing)" },
    ...(onAnchorClick ? [{ id: "anchor" as Tool, icon: "⚓", title: "Anchor VWAP to clicked bar" }] : []),
  ];

  const active = tool !== "cursor";

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => (mouseRef.current = null)}
        className={cn("absolute inset-0 z-20", active ? "pointer-events-auto cursor-crosshair" : "pointer-events-none")}
      />
      <div className="absolute left-1 top-6 z-30 flex flex-col gap-0.5 rounded border border-neutral-800 bg-neutral-900/90 p-0.5">
        {tools.map((t) => (
          <button
            key={t.id}
            title={t.title}
            onClick={() => {
              anchorRef.current = null;
              setTool(t.id);
            }}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded text-xs",
              tool === t.id ? "bg-blue-600 text-white" : "text-neutral-400 hover:bg-neutral-800",
            )}
          >
            {t.icon}
          </button>
        ))}
        {drawings.length > 0 && (
          <button
            title="Clear all drawings"
            onClick={() => persistDrawings([])}
            className="flex h-6 w-6 items-center justify-center rounded text-xs text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
          >
            🗑
          </button>
        )}
      </div>
    </>
  );
}
