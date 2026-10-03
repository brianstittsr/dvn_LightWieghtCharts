/**
 * Futures bot engine — polls bars, evaluates a strategy (built-in EMA cross or
 * AI-generated code via desiredFromCode), and reconciles the open position on
 * the linked ProjectX account with bracket TP/SL orders.
 *
 * Runs in the Next.js server process: bots stop when the server restarts and
 * there is a single runner per server instance.
 */
import { desiredFromCode } from "@/lib/backtest";
import { ema } from "@/lib/indicators/math";
import {
  projectxAccounts,
  projectxBars,
  projectxCancelOrder,
  projectxCloseContract,
  projectxContractById,
  projectxOpenOrders,
  projectxOpenPositions,
  projectxPlaceOrder,
  projectxToken,
  userCredsFor,
  PX_BAR_UNIT,
  PX_ORDER_TYPE,
  PX_SIDE,
  type ProjectXCreds,
} from "@/lib/platforms/projectx";
import { readJson, writeJson } from "@/lib/server-store";
import type { Candle } from "@/lib/types";

type Desired = "long" | "short" | "flat";

const FILE = "futures-bots.json";
const POLL_MS = 5_000;
const MAX_EVENTS = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

/** "30s" polls 1-minute bars but evaluates the live partial bar every tick. */
export type BotTimeframe = "30s" | "1m" | "5m" | "15m" | "1h";

export interface EmaCrossStrategy {
  kind: "ema-cross";
  fastLen: number;
  slowLen: number;
  /** Optional seed values to skip the warmup wait (per the TopStepX bot UI). */
  initialFast?: number;
  initialSlow?: number;
}

export interface CustomStrategy {
  kind: "custom";
  name: string;
  /** The AI prompt used to generate the code — kept for edit/regenerate. */
  prompt: string;
  code: string;
  params: Record<string, number>;
}

export type BotStrategy = EmaCrossStrategy | CustomStrategy;

export interface BotEvent {
  t: string;
  type: "entry" | "exit" | "signal" | "error" | "info";
  msg: string;
  price?: number;
  size?: number;
  /** Free-form metrics shown in the event card (EMAs, balance, …). */
  extras?: Record<string, number>;
}

export interface FuturesBot {
  id: string;
  ownerUid: string | null;
  name: string;
  platform: "topstep" | "apex";
  /** Optional pin — falls back to the linked account/env resolution. */
  accountId?: number;
  contractId: string;
  contractName?: string;
  timeframe: BotTimeframe;
  size: number;
  slPoints: number;
  tpPoints: number;
  strategy: BotStrategy;
  state: "stopped" | "running";
  /** Last closed-bar timestamp already traded on — prevents duplicate signals. */
  lastBarTime?: string;
  events: BotEvent[];
  createdAt: string;
  updatedAt: string;
}

const TF_MS: Record<BotTimeframe, number> = {
  "30s": 30_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
};
const TF_UNIT: Record<BotTimeframe, number> = {
  "30s": PX_BAR_UNIT.Minute,
  "1m": PX_BAR_UNIT.Minute,
  "5m": PX_BAR_UNIT.Minute,
  "15m": PX_BAR_UNIT.Minute,
  "1h": PX_BAR_UNIT.Hour,
};
const TF_UNIT_NUM: Record<BotTimeframe, number> = {
  "30s": 1, "1m": 1, "5m": 5, "15m": 15, "1h": 1,
};

// ── Store ─────────────────────────────────────────────────────────────────────

async function loadBots(): Promise<FuturesBot[]> {
  const list = await readJson<FuturesBot[]>(FILE, []);
  return Array.isArray(list) ? list : [];
}

export async function listBots(uid: string | null): Promise<FuturesBot[]> {
  const bots = await loadBots();
  return uid ? bots.filter((b) => b.ownerUid === uid || b.ownerUid === null) : bots;
}

export async function saveBot(bot: FuturesBot): Promise<void> {
  const bots = await loadBots();
  const i = bots.findIndex((b) => b.id === bot.id);
  if (i >= 0) bots[i] = bot;
  else bots.push(bot);
  await writeJson(FILE, bots);
}

export async function deleteBot(id: string): Promise<void> {
  await stopBot(id);
  const bots = await loadBots();
  await writeJson(FILE, bots.filter((b) => b.id !== id));
}

export async function getBot(id: string): Promise<FuturesBot | undefined> {
  return (await loadBots()).find((b) => b.id === id);
}

function log(bot: FuturesBot, e: BotEvent): void {
  bot.events = [e, ...bot.events].slice(0, MAX_EVENTS);
}

// ── Engine ────────────────────────────────────────────────────────────────────

const runners = new Map<string, { timer: NodeJS.Timeout; ticking: boolean }>();

export function botRunning(id: string): boolean {
  return runners.has(id);
}

async function resolve(bot: FuturesBot): Promise<{
  creds: ProjectXCreds;
  accountId: number;
}> {
  const r = await userCredsFor(bot.platform, bot.ownerUid);
  const accountId = bot.accountId ?? r?.accountId;
  if (!r) throw new Error(`No ${bot.platform} credentials resolved for this bot's owner`);
  if (!accountId) throw new Error("No accountId pinned on the bot or its linked account");
  return { creds: r.creds, accountId };
}

function toCandles(bars: { t: string; o: number; h: number; l: number; c: number; v: number }[]): Candle[] {
  return bars.map((b) => ({
    time: Math.floor(new Date(b.t).getTime() / 1000) as Candle["time"],
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

function evalSignal(bot: FuturesBot, candles: Candle[]): { desired: Desired; extras: Record<string, number> } {
  const s = bot.strategy;
  if (s.kind === "ema-cross") {
    const closes = candles.map((c) => c.close);
    let f: number | null;
    let sv: number | null;
    if (s.initialFast != null && s.initialSlow != null) {
      // Seed values let the bot trade immediately — continue the EMA from the
      // seeds across the loaded closes instead of waiting for warmup bars.
      let ff = s.initialFast;
      let ss = s.initialSlow;
      const kf = 2 / (s.fastLen + 1);
      const ks = 2 / (s.slowLen + 1);
      for (const c of closes) {
        ff += (c - ff) * kf;
        ss += (c - ss) * ks;
      }
      f = ff;
      sv = ss;
    } else {
      const fast = ema(closes, s.fastLen);
      const slow = ema(closes, s.slowLen);
      f = fast[closes.length - 1];
      sv = slow[closes.length - 1];
    }
    return {
      desired: f != null && sv != null ? (f > sv ? "long" : f < sv ? "short" : "flat") : "flat",
      extras: { [`${s.fastLen} EMA`]: f ?? 0, [`${s.slowLen} EMA`]: sv ?? 0 },
    };
  }
  const desired = desiredFromCode(s.code, candles, s.params);
  return { desired: desired[desired.length - 1] ?? "flat", extras: {} };
}

async function tick(bot: FuturesBot): Promise<void> {
  const tfMs = TF_MS[bot.timeframe];
  const slowLen = bot.strategy.kind === "ema-cross" ? bot.strategy.slowLen : 300;
  const lookback = tfMs * Math.min(slowLen + 20, 400);
  const { creds, accountId } = await resolve(bot);

  const [bars, positions, contract] = await Promise.all([
    projectxBars(
      creds,
      bot.contractId,
      TF_UNIT[bot.timeframe],
      TF_UNIT_NUM[bot.timeframe],
      lookback,
      slowLen + 20,
    ),
    projectxOpenPositions(creds, accountId),
    projectxContractById(creds, bot.contractId).catch(() => null),
  ]);

  const pos = positions.find((p) => p.contractId === bot.contractId) ?? null;
  const last = bars.length ? bars[bars.length - 1].c : null;
  const tickSize = contract?.tickSize || 0.25;
  const slTicks = Math.max(1, Math.round(bot.slPoints / tickSize));
  const tpTicks = Math.max(1, Math.round(bot.tpPoints / tickSize));

  // Closed bars only for minute+ timeframes — "30s" evaluates the live bar
  // every poll (continuous evaluation like the reference bot).
  const closed = bot.timeframe === "30s" ? bars : bars.slice(0, -1);
  const lastClosed = closed[closed.length - 1];
  if (!lastClosed) return;
  if (bot.timeframe !== "30s" && lastClosed.t === bot.lastBarTime) return;

  bot.lastBarTime = lastClosed.t;
  const { desired, extras } = evalSignal(bot, toCandles(closed));
  extras["Market Open"] = lastClosed.o;
  extras["Market Close"] = lastClosed.c;
  const posSide = pos ? (pos.type === 1 ? "long" : "short") : "flat";

  if (desired !== posSide) {
    log(bot, {
      t: new Date().toISOString(),
      type: "signal",
      msg: `${desired.toUpperCase()} signal (was ${posSide})`,
      price: last ?? undefined,
      extras,
    });
  }

  const flip = async (side: "buy" | "sell") => {
    if (pos) await projectxCloseContract(creds, accountId, bot.contractId);
    const { orderId } = await projectxPlaceOrder(creds, {
      accountId,
      contractId: bot.contractId,
      type: PX_ORDER_TYPE.Market,
      side: side === "buy" ? PX_SIDE.Buy : PX_SIDE.Sell,
      size: bot.size,
      takeProfitTicks: bot.tpPoints > 0 ? tpTicks : undefined,
      stopLossTicks: bot.slPoints > 0 ? slTicks : undefined,
      customTag: `bot:${bot.id}`,
    });
    const balance = await projectxAccounts(creds, await projectxToken(creds))
      .then((a) => a.find((x) => x.id === accountId)?.balance)
      .catch(() => undefined);
    log(bot, {
      t: new Date().toISOString(),
      type: "entry",
      msg: `${side === "buy" ? "BUY" : "SELL"} ${bot.size} @ MARKET (order ${orderId})`,
      price: last ?? undefined,
      size: bot.size,
      extras: { ...extras, ...(balance != null ? { "Account Balance": balance } : {}) },
    });
  };

  if (desired === "long" && posSide !== "long") await flip("buy");
  else if (desired === "short" && posSide !== "short") await flip("sell");
  else if (desired === "flat" && pos) {
    await projectxCloseContract(creds, accountId, bot.contractId);
    log(bot, {
      t: new Date().toISOString(),
      type: "exit",
      msg: `CLOSED ${posSide} ${pos.size} @ MARKET`,
      price: last ?? undefined,
      size: pos.size,
      extras,
    });
  }
  await saveBot(bot);
}

export async function startBot(id: string): Promise<void> {
  const bot = await getBot(id);
  if (!bot) throw new Error("Bot not found");
  if (runners.has(id)) return;
  const r = { timer: null as NodeJS.Timeout | null, ticking: false };
  const loop = async () => {
    if (r.ticking) return;
    r.ticking = true;
    try {
      const fresh = await getBot(id);
      if (fresh && fresh.state === "running") await tick(fresh);
    } catch (e) {
      const b = await getBot(id);
      if (b) {
        log(b, {
          t: new Date().toISOString(),
          type: "error",
          msg: e instanceof Error ? e.message : "Bot tick failed",
        });
        await saveBot(b).catch(() => {});
      }
    } finally {
      r.ticking = false;
    }
  };
  bot.state = "running";
  log(bot, { t: new Date().toISOString(), type: "info", msg: "Bot started" });
  await saveBot(bot);
  r.timer = setInterval(loop, POLL_MS);
  runners.set(id, r as { timer: NodeJS.Timeout; ticking: boolean });
  void loop();
}

export async function stopBot(id: string): Promise<void> {
  const r = runners.get(id);
  if (r) {
    clearInterval(r.timer);
    runners.delete(id);
  }
  const bot = await getBot(id);
  if (bot && bot.state === "running") {
    bot.state = "stopped";
    log(bot, { t: new Date().toISOString(), type: "info", msg: "Bot stopped" });
    await saveBot(bot);
  }
}

/** Stop + flatten the bot's contract position and cancel its open orders. */
export async function killBot(id: string): Promise<{ closed: boolean; cancelled: number }> {
  const bot = await getBot(id);
  await stopBot(id);
  if (!bot) throw new Error("Bot not found");
  const { creds, accountId } = await resolve(bot);
  const positions = await projectxOpenPositions(creds, accountId);
  const orders = (await projectxOpenOrders(creds, accountId)).filter(
    (o) => o.contractId === bot.contractId,
  );
  const has = positions.some((p) => p.contractId === bot.contractId);
  if (has) await projectxCloseContract(creds, accountId, bot.contractId);
  await Promise.all(orders.map((o) => projectxCancelOrder(creds, accountId, o.id)));
  const b = await getBot(id);
  if (b) {
    log(b, {
      t: new Date().toISOString(),
      type: "info",
      msg: `Killed — position ${has ? "closed" : "none"}, ${orders.length} order(s) cancelled`,
    });
    await saveBot(b);
  }
  return { closed: has, cancelled: orders.length };
}
