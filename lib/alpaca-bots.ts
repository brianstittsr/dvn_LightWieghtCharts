/**
 * Alpaca bot engine — polls bars, evaluates a strategy (built-in EMA cross or
 * AI-generated code via desiredFromCode), and reconciles the Alpaca paper
 * position with bracket (stocks) or engine-managed (crypto) TP/SL.
 *
 * Constraints handled here:
 *  - Alpaca rejects bracket orders for crypto → engine exits TP/SL manually.
 *  - Alpaca crypto is long-only → crypto bots never short.
 * Runs in the Next.js server process, same model as lib/futures-bots.ts.
 */
import { alpaca, userAlpacaCreds, type AlpacaKeys } from "@/lib/alpaca";
import { desiredFromCode } from "@/lib/backtest";
import { ema } from "@/lib/indicators/math";
import { alpacaCryptoSymbol, barsFor } from "@/lib/scanner/data";
import { storeDelete, storeList, storePut } from "@/lib/store";
import type { Candle } from "@/lib/types";

type Desired = "long" | "short" | "flat";
type AssetKind = "stock" | "crypto";
export type AlpacaTimeframe = "1m" | "5m" | "15m" | "1h";

const POLL_MS = 5_000;
const MAX_EVENTS = 200;

export interface AlpacaBotEvent {
  t: string;
  type: "entry" | "exit" | "signal" | "error" | "info";
  msg: string;
  price?: number;
  size?: number;
  extras?: Record<string, number>;
}

export interface AlpacaBot {
  id: string;
  ownerUid: string;
  name: string;
  /** Raw symbol — "AMD" for stocks, "BTC" for crypto. */
  symbol: string;
  assetClass: AssetKind;
  timeframe: AlpacaTimeframe;
  qty: number;
  /** TP/SL as % from entry price (0 disables). */
  slPct: number;
  tpPct: number;
  strategy:
    | { kind: "ema-cross"; fastLen: number; slowLen: number }
    | { kind: "custom"; name: string; prompt: string; code: string; params: Record<string, number> };
  state: "stopped" | "running";
  lastBarTime?: number;
  /** Entry price tracked for crypto engine-managed TP/SL. */
  entryPx?: number;
  events: AlpacaBotEvent[];
  createdAt: string;
  updatedAt: string;
}

// ── Alpaca helpers ────────────────────────────────────────────────────────────

interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: "long" | "short";
  avg_entry_price: string;
  current_price?: string;
  unrealized_pl?: string;
}

/** The symbol format Alpaca uses for a position (crypto drops the "/"). */
function posSymbol(bot: AlpacaBot): string {
  return bot.assetClass === "crypto"
    ? alpacaCryptoSymbol(bot.symbol).replace("/", "")
    : bot.symbol.toUpperCase();
}

function orderSymbol(bot: AlpacaBot): string {
  return bot.assetClass === "crypto"
    ? alpacaCryptoSymbol(bot.symbol)
    : bot.symbol.toUpperCase();
}

async function findPosition(
  bot: AlpacaBot,
  keys: AlpacaKeys,
): Promise<AlpacaPosition | null> {
  const positions = await alpaca<AlpacaPosition[]>(
    "/v2/positions",
    undefined,
    keys,
  );
  return positions.find((p) => p.symbol === posSymbol(bot)) ?? null;
}

async function closePosition(bot: AlpacaBot, keys: AlpacaKeys): Promise<void> {
  await alpaca(
    `/v2/positions/${encodeURIComponent(posSymbol(bot))}`,
    { method: "DELETE" },
    keys,
  );
}

async function enterLong(
  bot: AlpacaBot,
  entryPx: number,
  keys: AlpacaKeys,
): Promise<void> {
  const crypto = bot.assetClass === "crypto";
  await alpaca("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: orderSymbol(bot),
      qty: String(bot.qty),
      side: "buy",
      type: "market",
      time_in_force: crypto ? "gtc" : "day",
      ...(crypto
        ? {}
        : {
            order_class: "bracket",
            ...(bot.tpPct > 0
              ? { take_profit: { limit_price: (entryPx * (1 + bot.tpPct / 100)).toFixed(2) } }
              : {}),
            ...(bot.slPct > 0
              ? { stop_loss: { stop_price: (entryPx * (1 - bot.slPct / 100)).toFixed(2) } }
              : {}),
          }),
    }),
  }, keys);
  bot.entryPx = entryPx;
}

async function enterShort(
  bot: AlpacaBot,
  entryPx: number,
  keys: AlpacaKeys,
): Promise<void> {
  await alpaca("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: orderSymbol(bot),
      qty: String(bot.qty),
      side: "sell",
      type: "market",
      time_in_force: "day",
      order_class: "bracket",
      ...(bot.tpPct > 0
        ? { take_profit: { limit_price: (entryPx * (1 - bot.tpPct / 100)).toFixed(2) } }
        : {}),
      ...(bot.slPct > 0
        ? { stop_loss: { stop_price: (entryPx * (1 + bot.slPct / 100)).toFixed(2) } }
        : {}),
    }),
  }, keys);
}

// ── Store ─────────────────────────────────────────────────────────────────────

async function loadBots(): Promise<AlpacaBot[]> {
  return storeList<AlpacaBot>("bots.json");
}

export async function listAlpacaBots(uid: string): Promise<AlpacaBot[]> {
  return (await loadBots()).filter((b) => b.ownerUid === uid);
}

export async function saveAlpacaBot(bot: AlpacaBot): Promise<void> {
  bot.updatedAt = new Date().toISOString();
  await storePut("bots.json", bot);
}

export async function getAlpacaBot(id: string): Promise<AlpacaBot | undefined> {
  return (await loadBots()).find((b) => b.id === id);
}

export async function deleteAlpacaBot(id: string): Promise<void> {
  await stopAlpacaBot(id);
  await storeDelete("bots.json", id);
}

function log(bot: AlpacaBot, e: AlpacaBotEvent): void {
  bot.events = [e, ...bot.events].slice(0, MAX_EVENTS);
}

// ── Engine ────────────────────────────────────────────────────────────────────

const runners = new Map<string, { timer: NodeJS.Timeout; ticking: boolean }>();

export function alpacaBotRunning(id: string): boolean {
  return runners.has(id);
}

function evalSignal(bot: AlpacaBot, candles: Candle[]): {
  desired: Desired;
  extras: Record<string, number>;
} {
  const s = bot.strategy;
  if (s.kind === "ema-cross") {
    const closes = candles.map((c) => c.close);
    const fast = ema(closes, s.fastLen).at(-1);
    const slow = ema(closes, s.slowLen).at(-1);
    return {
      desired:
        fast != null && slow != null
          ? fast > slow
            ? "long"
            : fast < slow
              ? "short"
              : "flat"
          : "flat",
      extras: { [`${s.fastLen} EMA`]: fast ?? 0, [`${s.slowLen} EMA`]: slow ?? 0 },
    };
  }
  const desired = desiredFromCode(s.code, candles, s.params);
  return { desired: desired.at(-1) ?? "flat", extras: {} };
}

const NO_CREDS_MSG =
  "No Alpaca account linked — add an Alpaca trading account in Admin or set APCA_* env vars";

async function tick(bot: AlpacaBot): Promise<void> {
  const keys = await userAlpacaCreds(bot.ownerUid);
  if (!keys) {
    if (bot.events[0]?.msg !== NO_CREDS_MSG) {
      log(bot, {
        t: new Date().toISOString(),
        type: "error",
        msg: NO_CREDS_MSG,
      });
      await saveAlpacaBot(bot);
    }
    return;
  }
  const lookback = Math.min(400, (bot.strategy.kind === "ema-cross" ? bot.strategy.slowLen : 300) + 20);
  const candles = await barsFor(
    bot.assetClass,
    bot.symbol,
    bot.timeframe,
    lookback,
    null,
    keys,
  );
  const closed = candles.slice(0, -1);
  const lastClosed = closed.at(-1);
  if (!lastClosed || lastClosed.time === bot.lastBarTime) return;
  bot.lastBarTime = lastClosed.time;

  const { desired: rawDesired, extras } = evalSignal(bot, closed);
  // Alpaca crypto is long-only — a short signal flattens instead.
  const desired: Desired =
    bot.assetClass === "crypto" && rawDesired === "short" ? "flat" : rawDesired;
  extras["Last close"] = lastClosed.close;

  const pos = await findPosition(bot, keys);
  const posSide: Desired = pos
    ? pos.side === "long"
      ? "long"
      : "short"
    : "flat";
  const last = candles.at(-1)?.close ?? lastClosed.close;

  // Crypto engine-managed TP/SL — Alpaca can't bracket crypto.
  if (bot.assetClass === "crypto" && pos && bot.entryPx) {
    const pnlPct = ((last - bot.entryPx) / bot.entryPx) * 100;
    if ((bot.tpPct > 0 && pnlPct >= bot.tpPct) || (bot.slPct > 0 && pnlPct <= -bot.slPct)) {
      await closePosition(bot, keys);
      log(bot, {
        t: new Date().toISOString(),
        type: "exit",
        msg: `${pnlPct >= 0 ? "TP" : "SL"} hit — closed long (${pnlPct.toFixed(2)}%)`,
        price: last,
        size: Number(pos.qty),
      });
      await saveAlpacaBot(bot);
      return;
    }
  }

  if (desired !== posSide) {
    log(bot, {
      t: new Date().toISOString(),
      type: "signal",
      msg: `${desired.toUpperCase()} signal (was ${posSide})`,
      price: last,
      extras,
    });
  }

  const flip = async (side: "buy" | "sell") => {
    if (pos) await closePosition(bot, keys);
    if (side === "buy") await enterLong(bot, lastClosed.close, keys);
    else await enterShort(bot, lastClosed.close, keys);
    log(bot, {
      t: new Date().toISOString(),
      type: "entry",
      msg: `${side === "buy" ? "BUY" : "SELL"} ${bot.qty} ${orderSymbol(bot)} @ MARKET`,
      price: last,
      size: bot.qty,
      extras,
    });
  };

  if (desired === "long" && posSide !== "long") await flip("buy");
  else if (desired === "short" && posSide !== "short") await flip("sell");
  else if (desired === "flat" && pos) {
    await closePosition(bot, keys);
    log(bot, {
      t: new Date().toISOString(),
      type: "exit",
      msg: `CLOSED ${posSide} ${pos.qty} @ MARKET`,
      price: last,
      size: Number(pos.qty),
      extras,
    });
    bot.entryPx = undefined;
  }
  await saveAlpacaBot(bot);
}

export async function startAlpacaBot(id: string): Promise<void> {
  const bot = await getAlpacaBot(id);
  if (!bot) throw new Error("Bot not found");
  if (!(await userAlpacaCreds(bot.ownerUid))) throw new Error(NO_CREDS_MSG);
  if (runners.has(id)) return;
  const r = { timer: null as NodeJS.Timeout | null, ticking: false };
  const loop = async () => {
    if (r.ticking) return;
    r.ticking = true;
    try {
      const fresh = await getAlpacaBot(id);
      if (fresh && fresh.state === "running") await tick(fresh);
    } catch (e) {
      const b = await getAlpacaBot(id);
      if (b) {
        log(b, {
          t: new Date().toISOString(),
          type: "error",
          msg: e instanceof Error ? e.message : "Bot tick failed",
        });
        await saveAlpacaBot(b).catch(() => {});
      }
    } finally {
      r.ticking = false;
    }
  };
  bot.state = "running";
  log(bot, { t: new Date().toISOString(), type: "info", msg: "Bot started" });
  await saveAlpacaBot(bot);
  r.timer = setInterval(loop, POLL_MS);
  runners.set(id, r as { timer: NodeJS.Timeout; ticking: boolean });
  void loop();
}

export async function stopAlpacaBot(id: string): Promise<void> {
  const r = runners.get(id);
  if (r) {
    clearInterval(r.timer);
    runners.delete(id);
  }
  const bot = await getAlpacaBot(id);
  if (bot && bot.state === "running") {
    bot.state = "stopped";
    log(bot, { t: new Date().toISOString(), type: "info", msg: "Bot stopped" });
    await saveAlpacaBot(bot);
  }
}

/** Stop + flatten the bot's Alpaca position and cancel its open orders. */
export async function killAlpacaBot(
  id: string,
): Promise<{ closed: boolean; cancelled: number }> {
  const bot = await getAlpacaBot(id);
  await stopAlpacaBot(id);
  if (!bot) throw new Error("Bot not found");
  const keys = await userAlpacaCreds(bot.ownerUid);
  const pos = keys ? await findPosition(bot, keys).catch(() => null) : null;
  if (pos && keys) await closePosition(bot, keys);
  const orders = keys
    ? await alpaca<{ symbol: string; id: string }[]>(
        "/v2/orders?status=open",
        undefined,
        keys,
      ).catch(() => [] as { symbol: string; id: string }[])
    : [];
  const mine = orders.filter((o) => o.symbol === posSymbol(bot) || o.symbol === orderSymbol(bot));
  await Promise.all(
    mine.map((o) =>
      alpaca(`/v2/orders/${o.id}`, { method: "DELETE" }, keys ?? undefined).catch(
        () => {},
      ),
    ),
  );
  const b = await getAlpacaBot(id);
  if (b) {
    b.entryPx = undefined;
    log(b, {
      t: new Date().toISOString(),
      type: "info",
      msg: `Killed — position ${pos ? "closed" : "none"}, ${mine.length} order(s) cancelled`,
    });
    await saveAlpacaBot(b);
  }
  return { closed: Boolean(pos), cancelled: mine.length };
}

/** Live position + current price for the monitor card. */
export async function alpacaBotPosition(bot: AlpacaBot): Promise<{
  side: "long" | "short" | null;
  qty: number;
  entry?: number;
  current?: number;
  unrealizedPl?: number;
}> {
  const keys = await userAlpacaCreds(bot.ownerUid);
  const pos = keys ? await findPosition(bot, keys).catch(() => null) : null;
  const candles = await barsFor(
    bot.assetClass,
    bot.symbol,
    "1m",
    2,
    null,
    keys ?? undefined,
  ).catch(() => [] as Candle[]);
  return {
    side: pos ? pos.side : null,
    qty: pos ? Number(pos.qty) : 0,
    entry: pos ? Number(pos.avg_entry_price) : undefined,
    current: candles.at(-1)?.close,
    unrealizedPl: pos?.unrealized_pl ? Number(pos.unrealized_pl) : undefined,
  };
}
