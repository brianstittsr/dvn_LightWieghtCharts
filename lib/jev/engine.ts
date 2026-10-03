/**
 * Jev-style HFT simulation — a deterministic tick-level market-making engine
 * modeled on jarrodwatts/jev-trader.
 *
 * Every synthetic "block" (a decomposed tick), a model answers buy/sell with
 * probabilities + latency; a post-only quote posts inside the touch, replacing
 * the last resting order; fills happen when the next tick's price crosses the
 * resting quote — the bot earns the spread instead of paying it.
 *
 * Ticks are synthesized from OHLC candles (O→L→H→C or O→H→L→C with seeded
 * jitter) — a simulation aid, not real tick data. Everything is seeded so a
 * run replays identically.
 */
import { desiredFromCode } from "@/lib/backtest";
import type { Candle } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────────────────────

export type JevAction = "buy" | "sell" | "hold";

export interface JevDecision {
  action: JevAction;
  probabilities: { buy: number; sell: number; hold: number };
  /** Simulated model inference time in ms. */
  latencyMs: number;
  /** Model missed the block → no quote posted. */
  late: boolean;
}

export interface JevQuote {
  side: "buy" | "sell";
  price: number;
  size: number;
  /** Position cap forced the quote to the opposite side. */
  capped: boolean;
}

export interface JevFill {
  block: number;
  side: "buy" | "sell";
  price: number;
  size: number;
  latencyMs: number;
}

export interface JevPosition {
  side: "long" | "short" | "flat";
  size: number;
  entryPrice: number;
  unrealizedUsd: number;
}

export interface JevTotals {
  blocks: number;
  decisions: number;
  quotes: number;
  fills: number;
  lateBlocks: number;
  /** Simulated model inference spend — the "AI costs less than gas" metric. */
  aiUsd: number;
  /** Per-quote posting fee — the gas analogue. */
  feeUsd: number;
  realizedUsd: number;
  pnlUsd: number;
  pnlPct: number;
  wins: number;
  losses: number;
}

export interface JevBlockEvent {
  block: number;
  ts: number;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  decision: JevDecision;
  quote: JevQuote | null;
  fill: { side: "buy" | "sell"; size: number; price: number } | null;
  resting: { bidSize: number; askSize: number };
  position: JevPosition;
  totals: JevTotals;
}

export interface JevConfig {
  /** Synthetic ticks decomposed per candle ("blocks per bar"). */
  ticksPerBar: number;
  /** Order size in shares/units. */
  tradeSize: number;
  /** Max |position| in units. */
  positionCap: number;
  /** Synthetic bid/ask spread in basis points of mid. */
  spreadBps: number;
  /** How many ticks inside the touch our quote posts. */
  quoteInsideTicks: number;
  /** Fraction of blocks where the model is "late" (0–1). */
  lateRate: number;
  /** Simulated model cost per decision, USD. */
  aiCostUsd: number;
  /** Fee per quote posted, USD. */
  feeUsd: number;
  initialCapital: number;
  /** "momentum" or "strategy:<id>" for AI-generated strategy code. */
  model: string;
  seed: number;
}

export interface JevRun {
  symbol: string;
  timeframe: string;
  modelLabel: string;
  /** "stand-in" heuristic vs "ai" generated strategy. */
  modelKind: "stand-in" | "ai";
  startedAt: number;
  endedAt: number;
  events: JevBlockEvent[];
  fills: JevFill[];
  totals: JevTotals;
  config: JevConfig;
}

export const JEV_DEFAULTS = {
  ticksPerBar: 10,
  tradeSize: 5,
  positionCap: 25,
  spreadBps: 8,
  quoteInsideTicks: 1,
  lateRate: 0.02,
  aiCostUsd: 0.00006,
  feeUsd: 0.002,
  initialCapital: 10000,
} as const;

// ── Seeded RNG ────────────────────────────────────────────────────────────────

/** mulberry32 — small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Tick synthesis ────────────────────────────────────────────────────────────

export interface JevTick {
  /** Synthetic block index (0-based across the whole run). */
  block: number;
  ts: number;
  price: number;
  /** Index of the candle this tick came from. */
  barIndex: number;
}

/**
 * Decompose each candle into `per` ticks walking O → (first extreme) →
 * (second extreme) → C, with jitter clamped to the bar's [low, high].
 * Up bars travel low-first (O→L→H→C), down bars high-first — the standard
 * candle-path heuristic.
 */
export function decomposeCandles(
  candles: Candle[],
  per: number,
  rand: () => number,
): JevTick[] {
  const ticks: JevTick[] = [];
  let block = 0;
  for (let b = 0; b < candles.length; b++) {
    const c = candles[b];
    // Bar duration: gap to next candle, else reuse the previous gap.
    const dur =
      (b + 1 < candles.length ? candles[b + 1].time - c.time : c.time - (candles[b - 1]?.time ?? c.time - 60)) * 1000;
    const up = c.close >= c.open;
    const waypoints = up
      ? [c.open, c.low, c.high, c.close]
      : [c.open, c.high, c.low, c.close];
    // Distribute `per` ticks across the 3 legs.
    const legTicks = Math.max(1, Math.floor(per / 3));
    for (let leg = 0; leg < 3; leg++) {
      const from = waypoints[leg];
      const to = waypoints[leg + 1];
      const n = leg === 2 ? per - legTicks * 2 : legTicks;
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / n;
        const base = from + (to - from) * f;
        const jitter = (rand() - 0.5) * (c.high - c.low) * 0.05;
        const price = Math.min(c.high, Math.max(c.low, base + jitter));
        const ts = c.time * 1000 + Math.floor((dur * (leg + f)) / 3);
        ticks.push({ block: block++, ts, price, barIndex: b });
      }
    }
  }
  return ticks;
}

// ── Models ───────────────────────────────────────────────────────────────────

interface Model {
  label: string;
  kind: "stand-in" | "ai";
  decide(ticks: JevTick[], i: number, rand: () => number): JevDecision;
}

/** Built-in momentum stand-in — the jev `mock` model equivalent. */
function momentumModel(): Model {
  const K = 12;
  return {
    label: "jev-momentum",
    kind: "stand-in",
    decide(ticks, i, rand) {
      const lookback = Math.min(K, i);
      if (lookback < 3) {
        return {
          action: "hold",
          probabilities: { buy: 0.34, sell: 0.33, hold: 0.33 },
          latencyMs: 60 + rand() * 40,
          late: false,
        };
      }
      const recent = ticks[i].price;
      const past = ticks[i - lookback].price;
      const mom = (recent - past) / past;
      // Logistic squash: ~±0.15% momentum saturates the probabilities.
      const p = 1 / (1 + Math.exp(-mom * 2500));
      const noise = (rand() - 0.5) * 0.06;
      const buy = Math.min(0.98, Math.max(0.02, p + noise));
      const sell = Math.min(0.98, Math.max(0.02, 1 - buy));
      return {
        action: buy >= 0.55 ? "buy" : sell >= 0.55 ? "sell" : "hold",
        probabilities: { buy, sell, hold: buy >= 0.55 || sell >= 0.55 ? 0 : 1 - Math.abs(buy - sell) },
        latencyMs: 60 + rand() * 60,
        late: false,
      };
    },
  };
}

/**
 * AI-generated strategy as the brain — `desiredFromCode` evaluates once over
 * the candle set; each tick inherits its containing bar's desired position,
 * mapped to buy/sell/hold with confidence scaled by tick momentum.
 */
function strategyModel(
  code: string,
  params: Record<string, number>,
  candles: Candle[],
  name: string,
): Model {
  const desired = desiredFromCode(code, candles, params);
  return {
    label: `ai: ${name}`,
    kind: "ai",
    decide(ticks, i, rand) {
      const d = desired[ticks[i].barIndex] ?? "flat";
      const conf = 0.6 + rand() * 0.3;
      if (d === "long") {
        return {
          action: "buy",
          probabilities: { buy: conf, sell: 1 - conf, hold: 0 },
          latencyMs: 80 + rand() * 80,
          late: false,
        };
      }
      if (d === "short") {
        return {
          action: "sell",
          probabilities: { buy: 1 - conf, sell: conf, hold: 0 },
          latencyMs: 80 + rand() * 80,
          late: false,
        };
      }
      return {
        action: "hold",
        probabilities: { buy: 0.3 + rand() * 0.1, sell: 0.3 + rand() * 0.1, hold: 0.4 },
        latencyMs: 80 + rand() * 80,
        late: false,
      };
    },
  };
}

// ── Simulation ────────────────────────────────────────────────────────────────

const round = (v: number, dp = 6): number => Number(v.toFixed(dp));

/**
 * Run the market-making loop over the decomposed ticks.
 * A resting bid fills when the next tick trades at/below its price (taker
 * sell hits it); a resting ask fills at/above. Quotes are replaced every
 * block — so a quote effectively lives for one tick.
 */
export function runJevSim(
  candles: Candle[],
  symbol: string,
  timeframe: string,
  cfg: JevConfig,
  custom?: { name: string; code: string; params: Record<string, number> },
): JevRun {
  const rand = mulberry32(cfg.seed || 1);
  const ticks = decomposeCandles(candles, Math.max(2, cfg.ticksPerBar), rand);
  const model =
    cfg.model.startsWith("strategy:") && custom
      ? strategyModel(custom.code, custom.params, candles, custom.name)
      : momentumModel();

  const events: JevBlockEvent[] = [];
  const fills: JevFill[] = [];
  const tickSize = (px: number) => Math.max(px * 0.0001, 0.0001);

  let resting: JevQuote | null = null;
  let posQty = 0;
  let posEntry = 0;
  let realized = 0;
  let aiUsd = 0;
  let feeUsd = 0;
  let wins = 0;
  let losses = 0;
  let decisions = 0;
  let quotes = 0;
  let lateBlocks = 0;

  const closeSide = (fillQty: number, fillPx: number, side: "buy" | "sell"): void => {
    // Realize P&L on the portion that reduces/reverses the position.
    if (posQty === 0) return;
    const closing = Math.min(Math.abs(posQty), fillQty);
    const dir = side === "sell" ? 1 : -1; // we're selling into the fill
    const posDir = posQty > 0 ? 1 : -1;
    if (dir === posDir) return; // same direction = opening, not closing
    const pnl = (fillPx - posEntry) * closing * posDir;
    realized += pnl;
    if (pnl >= 0) wins++;
    else losses++;
  };

  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    const mid = tick.price;
    const halfSpread = (mid * cfg.spreadBps) / 20000;
    const bestBid = mid - halfSpread;
    const bestAsk = mid + halfSpread;

    // 1) Resolve resting quote against this tick's print.
    let fill: JevBlockEvent["fill"] = null;
    if (resting) {
      const q = resting;
      const filled =
        (q.side === "buy" && mid <= q.price) || (q.side === "sell" && mid >= q.price);
      if (filled) {
        closeSide(q.size, q.price, q.side);
        const prev = posQty;
        posQty += q.side === "buy" ? q.size : -q.size;
        if (prev === 0 || Math.sign(prev) !== Math.sign(posQty)) {
          // Opened or flipped — entry is this fill's price.
          posEntry = q.price;
        } else if (Math.abs(posQty) > Math.abs(prev)) {
          // Added same direction — VWAP the entry.
          posEntry =
            (posEntry * Math.abs(prev) + q.price * q.size) / Math.abs(posQty);
        }
        // Reduced same direction — entry price unchanged.
        fill = { side: q.side, size: q.size, price: q.price };
        fills.push({
          block: tick.block,
          side: q.side,
          price: q.price,
          size: q.size,
          latencyMs: events.at(-1)?.decision.latencyMs ?? 0,
        });
      }
      resting = null;
    }

    // 2) Model decision (may be late → hold, no quote).
    const late = rand() < cfg.lateRate;
    const base = model.decide(ticks, i, rand);
    const decision: JevDecision = late
      ? { ...base, action: "hold", late: true }
      : base;
    decisions++;
    aiUsd += cfg.aiCostUsd;
    if (late) lateBlocks++;

    // 3) Post the quote — position cap forces the reducing side.
    let quote: JevQuote | null = null;
    if (decision.action !== "hold") {
      let side = decision.action;
      let capped = false;
      const overLong = posQty >= cfg.positionCap && side === "buy";
      const overShort = posQty <= -cfg.positionCap && side === "sell";
      if (overLong) {
        side = "sell";
        capped = true;
      } else if (overShort) {
        side = "buy";
        capped = true;
      }
      const ts = tickSize(mid);
      const price =
        side === "buy"
          ? bestBid + ts * cfg.quoteInsideTicks
          : bestAsk - ts * cfg.quoteInsideTicks;
      // Clamp inside the touch when the spread is too tight.
      quote = {
        side,
        price: round(side === "buy" ? Math.min(price, bestAsk - ts) : Math.max(price, bestBid + ts)),
        size: cfg.tradeSize,
        capped,
      };
      resting = quote;
      quotes++;
      feeUsd += cfg.feeUsd;
    }

    // 4) Position + totals snapshot.
    const unrealized = posQty === 0 ? 0 : (mid - posEntry) * posQty;
    const pnlUsd = realized + unrealized - aiUsd - feeUsd;
    const position: JevPosition = {
      side: posQty > 0 ? "long" : posQty < 0 ? "short" : "flat",
      size: Math.abs(posQty),
      entryPrice: posEntry,
      unrealizedUsd: unrealized,
    };
    const totals: JevTotals = {
      blocks: tick.block + 1,
      decisions,
      quotes,
      fills: fills.length,
      lateBlocks,
      aiUsd: round(aiUsd, 6),
      feeUsd: round(feeUsd, 6),
      realizedUsd: round(realized, 6),
      pnlUsd: round(pnlUsd, 6),
      pnlPct: cfg.initialCapital > 0 ? (pnlUsd / cfg.initialCapital) * 100 : 0,
      wins,
      losses,
    };

    events.push({
      block: tick.block,
      ts: tick.ts,
      mid,
      bestBid: round(bestBid),
      bestAsk: round(bestAsk),
      spreadBps: cfg.spreadBps,
      decision,
      quote,
      fill,
      resting: {
        bidSize: resting?.side === "buy" ? resting.size : 0,
        askSize: resting?.side === "sell" ? resting.size : 0,
      },
      position,
      totals,
    });
  }

  const last = events.at(-1);
  return {
    symbol,
    timeframe,
    modelLabel: model.label,
    modelKind: model.kind,
    startedAt: ticks[0]?.ts ?? 0,
    endedAt: ticks.at(-1)?.ts ?? 0,
    events,
    fills,
    totals: last?.totals ?? {
      blocks: 0,
      decisions: 0,
      quotes: 0,
      fills: 0,
      lateBlocks: 0,
      aiUsd: 0,
      feeUsd: 0,
      realizedUsd: 0,
      pnlUsd: 0,
      pnlPct: 0,
      wins: 0,
      losses: 0,
    },
    config: cfg,
  };
}
