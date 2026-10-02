import type { Candle } from "@/lib/types";
import type { DataSource } from "@/lib/data-sources";
import { CRYPTO_SYMBOLS } from "@/lib/symbols";
import { TIMEFRAMES, HL_INTERVAL, TIMEFRAME_SECONDS, type Timeframe } from "@/lib/timeframe";

const REST_URL = "https://api.hyperliquid.xyz/info";
const WS_URL = "wss://api.hyperliquid.xyz/ws";

interface HlRestCandle {
  t: number; // open time ms
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

async function fetchHistory(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const interval = HL_INTERVAL[tf];
  const endTime = Date.now();
  const startTime = endTime - TIMEFRAME_SECONDS[tf] * 500 * 1000;
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin: symbol, interval, startTime, endTime },
    }),
  });
  if (!res.ok) throw new Error(`Hyperliquid history failed: ${res.status}`);
  const rows = (await res.json()) as HlRestCandle[];
  return rows.map((r) => ({
    time: Math.floor(r.t / 1000),
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
    volume: Number(r.v),
  }));
}

interface HlWsCandle {
  t: number;
  s: string;
  i: string;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

interface WsMessage {
  channel?: string;
  data?: HlWsCandle;
}

type Listener = (candle: Candle) => void;

/** Singleton websocket client with reconnect + ref-counted candle subscriptions. */
class HyperliquidWs {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Map<number, Listener>>();
  private nextId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private key(coin: string, interval: string): string {
    return `${coin}|${interval}`;
  }

  private connect(): void {
    if (this.ws) return;
    this.closed = false;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      for (const k of this.listeners.keys()) {
        const [coin, interval] = k.split("|");
        this.send({ method: "subscribe", subscription: { type: "candle", coin, interval } });
      }
    };
    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(ev.data) as WsMessage;
      } catch {
        return;
      }
      if (msg.channel !== "candle" || !msg.data) return;
      const d = msg.data;
      const cbs = this.listeners.get(this.key(d.s, d.i));
      if (!cbs) return;
      const candle: Candle = {
        time: Math.floor(d.t / 1000),
        open: Number(d.o),
        high: Number(d.h),
        low: Number(d.l),
        close: Number(d.c),
        volume: Number(d.v),
      };
      cbs.forEach((cb) => cb(candle));
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this.closed && this.listeners.size > 0) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    };
    ws.onerror = () => ws.close();
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(coin: string, interval: string, cb: Listener): () => void {
    const k = this.key(coin, interval);
    this.connect();
    if (!this.listeners.has(k)) {
      this.listeners.set(k, new Map());
      this.send({ method: "subscribe", subscription: { type: "candle", coin, interval } });
    }
    const id = this.nextId++;
    this.listeners.get(k)!.set(id, cb);
    return () => {
      const cbs = this.listeners.get(k);
      if (!cbs) return;
      cbs.delete(id);
      if (cbs.size === 0) {
        this.listeners.delete(k);
        this.send({ method: "unsubscribe", subscription: { type: "candle", coin, interval } });
      }
      if (this.listeners.size === 0) {
        this.closed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.ws?.close();
        this.ws = null;
      }
    };
  }
}

const wsClient = new HyperliquidWs();

export const hyperliquidSource: DataSource = {
  id: "hyperliquid",
  label: "Hyperliquid (crypto)",
  symbols: CRYPTO_SYMBOLS,
  timeframes: TIMEFRAMES,
  fetchHistory,
  subscribe(symbol, tf, onCandle) {
    return wsClient.subscribe(symbol, HL_INTERVAL[tf], onCandle);
  },
};
