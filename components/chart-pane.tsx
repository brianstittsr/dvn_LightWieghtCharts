"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type LineData,
  type SeriesMarker,
  type WhitespaceData,
} from "lightweight-charts";
import { getDataSource } from "@/lib/data-sources";
import { CRYPTO_SYMBOLS, FUTURE_SYMBOLS, STOCK_SYMBOLS, symbolInfo } from "@/lib/symbols";
import { TIMEFRAMES, type Timeframe } from "@/lib/timeframe";
import type { Candle } from "@/lib/types";
import { getIndicatorDef, loadCustomIndicators, saveCustomIndicator } from "@/lib/indicators/custom";
import { BUILTIN_INDICATORS } from "@/lib/indicators/builtin";
import type { IndicatorBox, IndicatorDef, IndicatorInstance, ParamDef } from "@/lib/indicators/types";
import { TickerBar } from "@/components/ticker-bar";
import { IndicatorMenu } from "@/components/indicator-menu";
import { OrderTicket } from "@/components/order-ticket";
import { FuturesTicket } from "@/components/futures-ticket";
import { DrawingLayer, type TpSlLevel } from "@/components/drawing-layer";
import { TradeAlertDialog, type TradeAlert } from "@/components/trade-alert-dialog";
import { TpslResultPopup, type TpslResult } from "@/components/tpsl-result-popup";
import { BacktestDialog } from "@/components/backtest-dialog";
import { BacktestResultPopup } from "@/components/backtest-result-popup";
import { CryptoNewsDialog } from "@/components/crypto-news-dialog";
import { JevDashboard } from "@/components/jev-dashboard";
import type { JevRun } from "@/lib/jev/engine";
import type { BacktestResult } from "@/lib/backtest";
import { useAlpacaPositions } from "@/lib/positions-store";
import { toAlpacaSymbol } from "@/lib/alpaca-symbol";
import { authFetch } from "@/lib/auth-fetch";

interface ChartPaneProps {
  paneId: string;
  defaultSymbol: string;
}

interface AppliedIndicator {
  defId: string;
  series: ISeriesApi<"Line">[];
}

const IND_STORAGE = (paneId: string) => `lwc-ind-${paneId}`;

/**
 * A drawn TP/SL level was reached: close the open Alpaca position for this
 * symbol at market and return the fill detail for the win/loss popup.
 * Returns null when there's no position to close — the manual order dialog
 * is shown instead (also the futures-pane path).
 */
async function closeTpslPosition(opts: {
  symbol: string;
  kind: "tp" | "sl";
  px: number;
  reason: string;
  fireAlert: (text: string) => void;
  setPendingTrade: (t: TradeAlert) => void;
  /** Replay mode: compute the hypothetical result without placing an order. */
  simulate?: boolean;
}): Promise<TpslResult | null> {
  const { symbol, kind, px, reason, fireAlert, setPendingTrade, simulate } = opts;
  const fallback = () => {
    setPendingTrade({ symbol, side: "sell", reason, price: px });
    return null;
  };
  if (symbolInfo(symbol).source === "futures") return fallback();
  try {
    const res = await fetch("/api/alpaca/positions");
    const body = (await res.json()) as {
      data?: { symbol: string; qty: string; avg_entry_price: string; side: string }[];
    };
    const target = toAlpacaSymbol(symbol).replace("/", "").toUpperCase();
    const pos = (body.data ?? []).find(
      (p) => p.symbol.replace("/", "").toUpperCase() === target,
    );
    if (!pos) return fallback();
    if (!simulate) {
      const close = await fetch(
        `/api/alpaca/positions?symbol=${encodeURIComponent(pos.symbol)}`,
        { method: "DELETE" },
      );
      if (!close.ok) {
        const errBody = (await close.json().catch(() => ({}))) as { error?: string };
        fireAlert(`${reason} — close failed: ${errBody.error ?? "unknown error"}`);
        return null;
      }
      fireAlert(`${reason} — closed ${pos.qty} ${pos.symbol} ≈ $${px.toFixed(2)}`);
    } else {
      fireAlert(`${reason} — simulated close ${pos.qty} ${pos.symbol} ≈ $${px.toFixed(2)}`);
    }
    const qty = Number(pos.qty);
    const entry = Number(pos.avg_entry_price);
    const side = pos.side === "short" ? "short" : "long";
    const pnl = (px - entry) * qty * (side === "short" ? -1 : 1);
    return { symbol, kind, side, qty, entry, exit: px, pnl };
  } catch {
    return fallback();
  }
}

/** Axis labels + crosshair in New York time so they match the session windows. */
const nyTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});
const nyDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});
const fmtNy = (time: number | UTCTimestamp) =>
  nyTime.format(new Date(Number(time) * 1000));
const fmtNyDay = (time: number | UTCTimestamp) =>
  nyDateTime.format(new Date(Number(time) * 1000));

function toLinePoint(p: { time: number; value: number | null }): LineData | WhitespaceData {
  return p.value == null
    ? ({ time: p.time as UTCTimestamp } as WhitespaceData)
    : ({ time: p.time as UTCTimestamp, value: p.value } as LineData);
}

/** One self-contained chart pane: symbol/timeframe pickers, indicators, order ticket. */
export function ChartPane({ paneId, defaultSymbol }: ChartPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const indSeriesRef = useRef<Map<number, AppliedIndicator>>(new Map());
  const instancesRef = useRef<IndicatorInstance[]>([]);

  const [symbol, setSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [price, setPrice] = useState<number | null>(null);
  const [dayOpen, setDayOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instances, setInstances] = useState<IndicatorInstance[]>([]);
  const [customDefs, setCustomDefs] = useState<IndicatorDef[]>([]);
  const positions = useAlpacaPositions();

  // Live P&L for the pane's open position, marked on every tick.
  const pos = positions.find(
    (p) => p.symbol.replace("/", "").toUpperCase() === toAlpacaSymbol(symbol).replace("/", "").toUpperCase(),
  );
  let posBadge: { side: string; qty: number; entry: number; pl: number; plPct: number } | null = null;
  if (pos) {
    const qty = Number(pos.qty);
    const entry = Number(pos.avg_entry_price);
    const mark = price ?? Number(pos.current_price);
    const pl = (pos.side === "short" ? entry - mark : mark - entry) * qty;
    posBadge = { side: pos.side, qty, entry, pl, plPct: entry * qty !== 0 ? (pl / (entry * qty)) * 100 : 0 };
  }
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [pendingTrade, setPendingTrade] = useState<TradeAlert | null>(null);
  /** Open futures position on this contract (futures panes only). */
  const [futPos, setFutPos] = useState<{
    symbol: string;
    position: { side: string; size: number; averagePrice: number } | null;
  } | null>(null);
  /** Symbol for which the user manually dismissed the futures ticket drawer. */
  const [futDismissed, setFutDismissed] = useState<string | null>(null);
  const isFutures = symbolInfo(symbol).source === "futures";
  const isCrypto = symbolInfo(symbol).source === "hyperliquid";
  const showFutTicket = isFutures && futDismissed !== symbol;
  const [newsOpen, setNewsOpen] = useState(false);
  const [btOpen, setBtOpen] = useState(false);
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [jevRun, setJevRun] = useState<JevRun | null>(null);
  const btMarkersRef = useRef<{
    api: { setMarkers: (m: SeriesMarker<UTCTimestamp>[]) => void };
    series: ISeriesApi<"Candlestick">;
  } | null>(null);
  const alertStateRef = useRef<Map<string, { armed: boolean; approached: boolean }>>(new Map());
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxesRef = useRef<IndicatorBox[]>([]);
  const tpslRef = useRef<TpSlLevel[]>([]);
  /** TP/SL levels that already fired — each line triggers only once. */
  const hitLevelsRef = useRef<Set<string>>(new Set());
  /** Filled by DrawingLayer — removes a fired TP/SL line. */
  const consumeLevelRef = useRef<((lvl: TpSlLevel) => void) | null>(null);
  /** Win/loss popup after a TP/SL-triggered close. */
  const [tpslResult, setTpslResult] = useState<TpslResult | null>(null);

  // ── Bar replay (TradingView-style) ─────────────────────────────
  /** Complete history — the replay source. Same array as candlesRef in live mode. */
  const fullCandlesRef = useRef<Candle[]>([]);
  /** Index into fullCandlesRef of the last displayed bar; null = live mode. */
  const replayIdxRef = useRef<number | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replaySelectingRef = useRef(false);
  /** Lets the chart-click subscription (created once) reach applyReplayTo. */
  const applyReplayToRef = useRef<((idx: number) => void) | null>(null);
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [replaySelecting, setReplaySelecting] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  /** Bars per second for playback. */
  const [replaySpeed, setReplaySpeed] = useState(2);
  /** Length of the loaded history — drives the scrubber's max. */
  const [histLen, setHistLen] = useState(0);
  /** Time of the current replay bar (shown in the control bar). */
  const [replayTime, setReplayTime] = useState<number | null>(null);
  /** Bump to force the history-load effect to refetch (exits replay into live). */
  const [reloadTick, setReloadTick] = useState(0);

  // Load persisted indicator instances + AI indicators after mount.
  useEffect(() => {
    const id = setTimeout(() => {
      setCustomDefs(loadCustomIndicators());
      try {
        const raw = window.localStorage.getItem(IND_STORAGE(paneId));
        if (raw) setInstances(JSON.parse(raw) as IndicatorInstance[]);
      } catch {
        /* ignore corrupt storage */
      }
    }, 0);
    return () => clearTimeout(id);
  }, [paneId]);

  const persist = useCallback(
    (next: IndicatorInstance[]) => {
      instancesRef.current = next;
      setInstances(next);
      window.localStorage.setItem(IND_STORAGE(paneId), JSON.stringify(next));
    },
    [paneId],
  );

  /** Recompute every applied indicator against the current candle array. */
  const recomputeIndicators = useCallback(() => {
    const candles = candlesRef.current;
    const boxes: IndicatorBox[] = [];
    for (const [idx, applied] of indSeriesRef.current) {
      const inst = instancesRef.current[idx];
      const def = inst && getIndicatorDef(inst.defId);
      if (!inst || !def) continue;
      try {
        const out = def.compute(candles, inst.params);
        out.series.forEach((s, i) => {
          applied.series[i]?.setData(s.values.map(toLinePoint));
        });
        if (out.boxes) boxes.push(...out.boxes);
      } catch (err) {
        console.error(`Indicator ${def.name} failed:`, err);
      }
    }
    boxesRef.current = boxes;
  }, []);

  const fireAlert = useCallback((text: string) => {
    console.warn(`[alert] ${text}`);
    setAlertMsg(text);
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setAlertMsg(null), 8000);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Session reversal", { body: text });
    }
  }, []);

  /**
   * Check alertable levels: (a) proximity alert when price approaches a
   * level, (b) sweep-and-reversal — arm when price pushes beyond the level,
   * fire when it falls back inside. Reversals open the trade popup.
   */
  const checkLevelAlerts = useCallback(
    (
      instIdx: number,
      def: { name: string },
      levels: { key: string; label: string; price: number; side: "above" | "below" }[],
      price: number,
      nearPct: number,
    ) => {
      for (const lvl of levels) {
        const key = `${instIdx}:${def.name}:${lvl.key}`;
        const state = alertStateRef.current.get(key) ?? { armed: false, approached: false };
        const dist = Math.abs(price - lvl.price) / lvl.price;

        // Proximity alert: fires once per approach, re-arms after moving away.
        if (dist <= nearPct && !state.approached) {
          state.approached = true;
          fireAlert(`${symbol}: approaching ${lvl.label} ${lvl.price.toFixed(2)} (price ${price.toFixed(2)})`);
        } else if (dist > nearPct * 2) {
          state.approached = false;
        }

        if (lvl.side === "above") {
          if (price > lvl.price) state.armed = true;
          else if (state.armed) {
            state.armed = false;
            const reason = `${symbol}: ${lvl.label} reversal — swept ${lvl.price.toFixed(2)} then broke back below`;
            fireAlert(reason);
            setPendingTrade({ symbol, side: "sell", reason, price });
          }
        } else {
          if (price < lvl.price) state.armed = true;
          else if (state.armed) {
            state.armed = false;
            const reason = `${symbol}: ${lvl.label} reversal — swept ${lvl.price.toFixed(2)} then broke back above`;
            fireAlert(reason);
            setPendingTrade({ symbol, side: "buy", reason, price });
          }
        }
        alertStateRef.current.set(key, state);
      }
    },
    [fireAlert, symbol, setPendingTrade],
  );

  /** Update only the latest point of each indicator (cheap path on live ticks). */
  const updateIndicatorsTick = useCallback(() => {
    const candles = candlesRef.current;
    const lastClose = candles[candles.length - 1]?.close;
    const boxes: IndicatorBox[] = [];
    for (const [idx, applied] of indSeriesRef.current) {
      const inst = instancesRef.current[idx];
      const def = inst && getIndicatorDef(inst.defId);
      if (!inst || !def) continue;
      try {
        const out = def.compute(candles, inst.params);
        out.series.forEach((s, i) => {
          const last = s.values[s.values.length - 1];
          if (last) applied.series[i]?.update(toLinePoint(last));
        });
        if (out.boxes) boxes.push(...out.boxes);
        if (out.levels && inst.params.alert && lastClose != null) {
          const nearPct = Number(inst.params.near ?? 0.15) / 100;
          checkLevelAlerts(idx, def, out.levels, lastClose, nearPct);
        }
      } catch (err) {
        console.error(`Indicator ${def.name} failed:`, err);
      }
    }
    boxesRef.current = boxes;
  }, [checkLevelAlerts]);

  /**
   * TP/SL touch check shared by live ticks and replayed bars. Broker-style
   * semantics: any bar whose range contains the level fills it. `simulate`
   * (replay mode) shows the win/loss result without placing a real order.
   */
  const checkTpSlLevels = useCallback(
    (tick: Candle, prev: number | undefined, simulate: boolean) => {
      for (const lvl of tpslRef.current) {
        // Each drawn level fires once — redraw it to re-arm.
        const key = `${lvl.kind}:${lvl.price}`;
        if (hitLevelsRef.current.has(key)) continue;
        const touched = tick.low <= lvl.price && tick.high >= lvl.price;
        const crossed =
          prev != null && (prev - lvl.price) * (tick.close - lvl.price) < 0;
        if (!touched && !crossed) continue;
        hitLevelsRef.current.add(key);
        // Remove the fired line from the chart.
        consumeLevelRef.current?.(lvl);
        const kind = lvl.kind === "tp" ? "Take profit" : "Stop loss";
        const reason = `${symbol}: ${kind} hit — price reached ${lvl.price.toFixed(2)}`;
        fireAlert(reason);
        void closeTpslPosition({
          symbol,
          kind: lvl.kind,
          px: tick.close,
          reason,
          fireAlert,
          setPendingTrade,
          simulate,
        }).then((res) => {
          if (res) setTpslResult(res);
        });
      }
    },
    [fireAlert, symbol, setPendingTrade, setTpslResult],
  );

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  /** Truncate the chart to a replay boundary index and refresh indicators. */
  const applyReplayTo = useCallback(
    (idx: number) => {
      const series = seriesRef.current;
      const full = fullCandlesRef.current;
      if (!series || !full.length) return;
      const clamped = Math.max(0, Math.min(idx, full.length - 1));
      replayIdxRef.current = clamped;
      setReplayIdx(clamped);
      candlesRef.current = full.slice(0, clamped + 1);
      series.setData(
        candlesRef.current.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
      );
      recomputeIndicators();
      const last = candlesRef.current[candlesRef.current.length - 1];
      if (last) {
        setPrice(last.close);
        setReplayTime(last.time);
      }
    },
    [recomputeIndicators],
  );
  useEffect(() => {
    applyReplayToRef.current = applyReplayTo;
  }, [applyReplayTo]);

  /** Append the next replayed bar through the same path a live tick takes. */
  const stepReplay = useCallback((): boolean => {
    const idx = replayIdxRef.current;
    const full = fullCandlesRef.current;
    if (idx == null || idx >= full.length - 1) return false;
    const prev = candlesRef.current[candlesRef.current.length - 1]?.close;
    const next = idx + 1;
    const bar = full[next];
    replayIdxRef.current = next;
    setReplayIdx(next);
    candlesRef.current.push(bar);
    seriesRef.current?.update({ ...bar, time: bar.time as UTCTimestamp });
    setPrice(bar.close);
    setReplayTime(bar.time);
    checkTpSlLevels(bar, prev, true);
    updateIndicatorsTick();
    return true;
  }, [checkTpSlLevels, updateIndicatorsTick]);

  /** Exit replay: drop the truncated view and refetch live data. */
  const exitReplay = useCallback(() => {
    replayIdxRef.current = null;
    setReplayIdx(null);
    setReplayPlaying(false);
    replaySelectingRef.current = false;
    setReplaySelecting(false);
    setReplayTime(null);
    stopReplayTimer();
    candlesRef.current = fullCandlesRef.current;
    setReloadTick((t) => t + 1);
  }, [
    stopReplayTimer,
    setReplayIdx,
    setReplayPlaying,
    setReplaySelecting,
    setReplayTime,
    setReloadTick,
  ]);

  // Playback clock — appends one bar per tick until history runs out.
  useEffect(() => {
    stopReplayTimer();
    if (replayPlaying) {
      replayTimerRef.current = setInterval(() => {
        if (!stepReplay()) setReplayPlaying(false);
      }, Math.max(40, Math.round(1000 / replaySpeed)));
    }
    return stopReplayTimer;
  }, [replayPlaying, replaySpeed, stepReplay, stopReplayTimer]);

  // Create chart once, resize with the pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#111318" },
        textColor: "#9ca3af",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1f2430" },
        horzLines: { color: "#1f2430" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#2a3040",
        // TickMarkType: 0=Year 1=Month 2=DayOfMonth 3=Time — show dates for
        // day-level marks, HH:mm for intraday.
        tickMarkFormatter: (time: UTCTimestamp, tickMarkType: number) =>
          tickMarkType <= 2 ? fmtNyDay(time) : fmtNy(time),
      },
      localization: { timeFormatter: fmtNy },
      rightPriceScale: { borderColor: "#2a3040" },
      crosshair: { mode: 0 },
      autoSize: false,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // Replay start selection: in "pick a bar" mode, a click sets the boundary.
    chart.subscribeClick((param) => {
      if (!replaySelectingRef.current) return;
      const t =
        param.time != null
          ? Number(param.time)
          : param.point
            ? Number(chart.timeScale().coordinateToTime(param.point.x) ?? 0)
            : 0;
      if (!t) return;
      const full = fullCandlesRef.current;
      if (!full.length) return;
      // Last bar at or before the clicked time becomes the replay head.
      let i = full.length - 1;
      while (i > 0 && full[i].time > t) i--;
      replaySelectingRef.current = false;
      setReplaySelecting(false);
      applyReplayToRef.current?.(i);
    });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    const indMap = indSeriesRef.current;
    return () => {
      ro.disconnect();
      indMap.clear();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load history + subscribe whenever symbol or timeframe changes.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const source = getDataSource(symbolInfo(symbol).source);
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    setError(null);
    setPrice(null);
    setDayOpen(null);
    setAlertMsg(null);
    candlesRef.current = [];
    alertStateRef.current.clear();
    hitLevelsRef.current.clear();
    // Leaving live mode for a new load resets any active replay.
    replayIdxRef.current = null;
    setReplayIdx(null);
    setReplayPlaying(false);
    replaySelectingRef.current = false;
    setReplaySelecting(false);
    setReplayTime(null);
    stopReplayTimer();

    source
      .fetchHistory(symbol, timeframe)
      .then((candles) => {
        if (cancelled) return;
        const arr = candles.slice();
        candlesRef.current = arr;
        fullCandlesRef.current = arr;
        setHistLen(arr.length);
        series.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
        chartRef.current?.timeScale().fitContent();
        const last = candles[candles.length - 1];
        if (last) {
          setPrice(last.close);
          const dayStart = candles.find((c) => c.time >= last.time - (last.time % 86400));
          setDayOpen(dayStart?.open ?? candles[0]?.open ?? null);
        }
        recomputeIndicators();
        unsubscribe = source.subscribe(symbol, timeframe, (tick) => {
          // Replaying — live ticks are parked until the user exits.
          if (replayIdxRef.current != null) return;
          const arr = candlesRef.current;
          const lastCandle = arr[arr.length - 1];
          // Stale tick (e.g. a delayed quote older than the last bar) — skip
          // it entirely; the chart can't update out-of-order bars.
          if (lastCandle && tick.time < lastCandle.time) return;
          checkTpSlLevels(tick, lastCandle?.close, false);
          if (lastCandle && lastCandle.time === tick.time) {
            arr[arr.length - 1] = tick;
          } else {
            arr.push(tick);
          }
          series.update({ ...tick, time: tick.time as UTCTimestamp });
          setPrice(tick.close);
          updateIndicatorsTick();
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error(err);
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [symbol, timeframe, reloadTick, recomputeIndicators, updateIndicatorsTick, fireAlert, checkTpSlLevels, stopReplayTimer]);

  // Poll the open futures position on this contract (for the header badge).
  useEffect(() => {
    if (!isFutures) return;
    let cancelled = false;
    let ctx: { platform: string; accountId: number } | null = null;
    const poll = async (): Promise<void> => {
      try {
        if (!ctx) {
          const s = await authFetch("/api/futures/status").then((r) =>
            r.ok ? (r.json() as Promise<{ data?: { platforms?: { id: string; configured?: boolean; linkedAccountId?: number; accounts?: { id: number }[] }[] } }>) : null,
          );
          const plat = s?.data?.platforms?.find(
            (p) => p.configured && (p.linkedAccountId || p.accounts?.length),
          );
          const accountId = plat?.linkedAccountId ?? plat?.accounts?.[0]?.id;
          if (!plat || !accountId) return;
          ctx = { platform: plat.id, accountId };
        }
        const d = await authFetch(
          `/api/futures/positions?platform=${ctx.platform}&accountId=${ctx.accountId}&symbol=${encodeURIComponent(symbol)}`,
        ).then((r) =>
          r.ok
            ? (r.json() as Promise<{ data?: { position?: { side: string; size: number; averagePrice: number } | null } }>)
            : null,
        );
        if (!cancelled && d) {
          setFutPos({ symbol, position: d.data?.position ?? null });
        }
      } catch {
        /* keep last badge on transient errors */
      }
    };
    void poll();
    const iv = setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [isFutures, symbol]);

  // Sync indicator line series with the instance list; recompute on param changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const map = indSeriesRef.current;

    // Remove series for deleted or re-typed instances.
    for (const [idx, applied] of map) {
      if (!instances[idx] || instances[idx].defId !== applied.defId) {
        applied.series.forEach((s) => chart.removeSeries(s));
        map.delete(idx);
      }
    }
    // Create series for new instances.
    instances.forEach((inst, idx) => {
      if (map.has(idx)) return;
      const def = getIndicatorDef(inst.defId);
      if (!def) return;
      try {
        const out = def.compute(candlesRef.current, inst.params);
        const lineSeries = out.series.map((s) =>
          chart.addSeries(
            LineSeries,
            {
              color: s.color,
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            },
            def.pane ?? 0,
          ),
        );
        map.set(idx, { defId: inst.defId, series: lineSeries });
      } catch (err) {
        console.error(`Indicator ${def.name} failed:`, err);
      }
    });
    instancesRef.current = instances;
    recomputeIndicators();
  }, [instances, customDefs, recomputeIndicators]);

  const addIndicator = useCallback(
    (defId: string) => {
      const def = getIndicatorDef(defId);
      if (!def) return;
      const defaults = Object.fromEntries(def.params.map((p) => [p.key, p.default]));
      persist([...instancesRef.current, { defId, params: defaults }]);
    },
    [persist],
  );

  const removeIndicator = useCallback(
    (index: number) => {
      persist(instancesRef.current.filter((_, i) => i !== index));
    },
    [persist],
  );

  const changeParam = useCallback(
    (index: number, key: string, value: number | string) => {
      persist(
        instancesRef.current.map((inst, i) =>
          i === index ? { ...inst, params: { ...inst.params, [key]: value } } : inst,
        ),
      );
    },
    [persist],
  );

  const onLevelsChange = useCallback((levels: TpSlLevel[]) => {
    tpslRef.current = levels;
    // Re-arm levels that no longer exist (erased/redrawn), keep hits for live ones.
    const keys = new Set(levels.map((l) => `${l.kind}:${l.price}`));
    for (const k of hitLevelsRef.current) {
      if (!keys.has(k)) hitLevelsRef.current.delete(k);
    }
  }, []);

  /** ⚓ tool clicked at time t — anchor every AVWAP instance to that bar. */
  const onAnchorClick = useCallback(
    (t: number) => {
      const next = instancesRef.current.map((inst) =>
        inst.defId === "avwap" ? { ...inst, params: { ...inst.params, anchor: 6, anchorTime: t } } : inst,
      );
      if (next.some((inst, i) => inst !== instancesRef.current[i])) {
        persist(next);
        setAlertMsg(`AVWAP anchored to ${new Date(t * 1000).toUTCString()}`);
        if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
        alertTimerRef.current = setTimeout(() => setAlertMsg(null), 4000);
      } else {
        setAlertMsg("Add the AVWAP indicator first, then click a bar to anchor it");
        if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
        alertTimerRef.current = setTimeout(() => setAlertMsg(null), 4000);
      }
    },
    [persist],
  );

  /** Backtest finished: show the result popup and mark trades on the chart. */
  const onBacktestResult = (r: BacktestResult): void => {
    setBtResult(r);
    const series = seriesRef.current;
    if (!series) return;
    if (btMarkersRef.current?.series !== series) {
      btMarkersRef.current = { api: createSeriesMarkers(series), series };
    }
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    for (const t of r.trades) {
      markers.push({
        time: t.entryTime as UTCTimestamp,
        position: t.side === "long" ? "belowBar" : "aboveBar",
        shape: t.side === "long" ? "arrowUp" : "arrowDown",
        color: t.side === "long" ? "#22c55e" : "#ef4444",
        text: t.side === "long" ? "B" : "S",
      });
      markers.push({
        time: t.exitTime as UTCTimestamp,
        position: t.side === "long" ? "aboveBar" : "belowBar",
        shape: "circle",
        color: t.pnl >= 0 ? "#22c55e" : "#ef4444",
        text: "",
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    btMarkersRef.current.api.setMarkers(markers);
  };

  const onGenerated = useCallback(
    (spec: { name: string; params: ParamDef[]; code: string }) => {
      const id = `ai-${Date.now().toString(36)}`;
      const def = saveCustomIndicator({ id, ...spec });
      setCustomDefs(loadCustomIndicators());
      const defaults = Object.fromEntries(def.params.map((p) => [p.key, p.default]));
      persist([...instancesRef.current, { defId: def.id, params: defaults }]);
    },
    [persist],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-[#111318]">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-2 py-1.5">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 outline-none"
          aria-label="Symbol"
        >
          <optgroup label="Futures — TopStepX">
            {FUTURE_SYMBOLS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Crypto — Hyperliquid">
            {CRYPTO_SYMBOLS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="US stocks — Alpaca">
            {STOCK_SYMBOLS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          className="rounded bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 outline-none"
          aria-label="Timeframe"
        >
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
        <IndicatorMenu
          instances={instances}
          defs={[...BUILTIN_INDICATORS, ...customDefs]}
          customDefs={customDefs}
          onAdd={addIndicator}
          onRemove={removeIndicator}
          onParamChange={changeParam}
          onGenerated={onGenerated}
          onCustomDeleted={() => setCustomDefs(loadCustomIndicators())}
        />
        <button
          onClick={() => setBtOpen(true)}
          title="Backtest a strategy on the loaded candles"
          className="rounded bg-neutral-800 px-1.5 py-1 text-[10px] font-medium text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
        >
          ▶ BT
        </button>
        <button
          onClick={() => {
            if (replayIdx != null || !fullCandlesRef.current.length) return;
            const next = !replaySelecting;
            replaySelectingRef.current = next;
            setReplaySelecting(next);
          }}
          disabled={replayIdx != null}
          title="Bar replay — click a candle to set the start point, then play it forward"
          className={`rounded px-1.5 py-1 text-[10px] font-medium disabled:opacity-40 ${
            replaySelecting
              ? "bg-blue-800/80 text-blue-100"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
          }`}
        >
          ⏮ Replay
        </button>
        <TickerBar label={symbolInfo(symbol).value} price={price} dayOpen={dayOpen} />
        {posBadge && (
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
              posBadge.pl >= 0 ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"
            }`}
            title={`${posBadge.side} ${posBadge.qty} @ ${posBadge.entry.toFixed(2)}`}
          >
            {posBadge.side === "short" ? "S" : "L"} {posBadge.qty} @ {posBadge.entry.toFixed(2)} ·{" "}
            {posBadge.pl >= 0 ? "+" : ""}${posBadge.pl.toFixed(2)} ({posBadge.plPct >= 0 ? "+" : ""}
            {posBadge.plPct.toFixed(2)}%)
          </span>
        )}
        {isFutures && futPos?.symbol === symbol && futPos.position && (
          <span
            className="rounded bg-blue-900/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-300"
            title={`${futPos.position.side} ${futPos.position.size} contract(s) @ ${futPos.position.averagePrice.toFixed(2)}`}
          >
            {futPos.position.side === "short" ? "S" : "L"} {futPos.position.size} @{" "}
            {futPos.position.averagePrice.toFixed(2)}
          </span>
        )}
        {alertMsg && (
          <span className="animate-pulse rounded bg-amber-500/20 px-2 py-1 text-[10px] font-medium text-amber-300">
            {alertMsg}
          </span>
        )}
        <OrderTicket paneSymbol={symbol} lastPrice={price} />
        {isCrypto && (
          <button
            onClick={() => setNewsOpen(true)}
            title={`Crypto news feed${symbol ? ` — ${symbol}` : ""}`}
            className="rounded bg-neutral-800 px-1.5 py-1 text-[10px] font-medium text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
          >
            📰
          </button>
        )}
        {isFutures && !showFutTicket && (
          <button
            onClick={() => setFutDismissed(null)}
            title="Open futures order ticket"
            className="rounded bg-amber-800/70 px-1.5 py-1 text-[10px] font-semibold text-amber-100 hover:bg-amber-700/80"
          >
            ⚡ Ticket
          </button>
        )}
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <DrawingLayer
          getChart={() => chartRef.current}
          getSeries={() => seriesRef.current}
          storageKey={`lwc-draw-${paneId}-${symbol}`}
          getBoxes={() => boxesRef.current}
          getCandles={() => candlesRef.current}
          onAnchorClick={onAnchorClick}
          onLevels={onLevelsChange}
          consumeLevelRef={consumeLevelRef}
        />
        {instances.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap gap-x-3 gap-y-0.5">
            {instances.map((inst, i) => {
              const def = getIndicatorDef(inst.defId);
              if (!def) return null;
              const colorParam = def.params.find((p) => p.type === "color");
              const color = colorParam ? String(inst.params[colorParam.key] ?? colorParam.default) : "#9ca3af";
              const short = def.name.split(" — ")[0];
              const len = inst.params.length;
              return (
                <span key={i} className="font-mono text-[10px] font-medium" style={{ color }}>
                  {short}
                  {typeof len === "number" ? ` ${len}` : ""}
                </span>
              );
            })}
          </div>
        )}
        {replaySelecting && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded bg-blue-900/85 px-3 py-1 text-[11px] font-medium text-blue-100">
            Bar replay — click a candle to set the start point
          </div>
        )}
        {replayIdx != null && (
          <div className="absolute bottom-10 left-1/2 z-20 flex w-[92%] max-w-[560px] -translate-x-1/2 items-center gap-2 rounded-lg border border-[#2a3040] bg-[#131722]/95 px-3 py-1.5 shadow-xl">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-blue-400">
              Replay
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, histLen - 1)}
              value={replayIdx}
              onChange={(e) => applyReplayTo(Number(e.target.value))}
              className="min-w-0 flex-1 accent-blue-500"
              aria-label="Replay position"
            />
            <button
              onClick={() => setReplayPlaying((p) => !p)}
              disabled={replayIdx >= histLen - 1}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
              title={replayPlaying ? "Pause" : "Play"}
            >
              {replayPlaying ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => {
                setReplayPlaying(false);
                stepReplay();
              }}
              disabled={replayIdx >= histLen - 1}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
              title="Step forward one bar"
            >
              ⏭
            </button>
            <select
              value={replaySpeed}
              onChange={(e) => setReplaySpeed(Number(e.target.value))}
              className="rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-200 outline-none"
              title="Playback speed (bars/second)"
            >
              {[0.5, 1, 2, 5, 10, 25].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <span className="shrink-0 font-mono text-[10px] text-neutral-400">
              {replayTime != null ? fmtNyDay(replayTime) : ""}
            </span>
            <button
              onClick={exitReplay}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-red-900/60 hover:text-red-200"
              title="Exit replay — return to live data"
            >
              ✕
            </button>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 px-4 text-center text-xs text-red-400">
            {error}
          </div>
        )}
        {showFutTicket && (
          <FuturesTicket
            key={symbol}
            variant="drawer"
            initialSymbol={symbol}
            open
            onClose={() => setFutDismissed(symbol)}
          />
        )}
      </div>
      <TradeAlertDialog alert={pendingTrade} onClose={() => setPendingTrade(null)} />
      <TpslResultPopup result={tpslResult} onClose={() => setTpslResult(null)} />
      <BacktestDialog
        open={btOpen}
        symbol={symbol}
        timeframe={timeframe}
        assetClass={isCrypto ? "crypto" : isFutures ? "future" : "stock"}
        getCandles={() => candlesRef.current}
        onResult={onBacktestResult}
        onJevResult={setJevRun}
        onClose={() => setBtOpen(false)}
      />
      <BacktestResultPopup result={btResult} onClose={() => setBtResult(null)} />
      {jevRun && <JevDashboard run={jevRun} onClose={() => setJevRun(null)} />}
      {newsOpen && isCrypto && (
        <CryptoNewsDialog symbol={symbol} onClose={() => setNewsOpen(false)} />
      )}
    </div>
  );
}
