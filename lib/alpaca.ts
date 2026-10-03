/** Server-side Alpaca paper-trading client. Keys come from .env.local. */

const BASE_URL = process.env.ALPACA_BASE_URL ?? "https://paper-api.alpaca.markets";

function alpacaKeys(): { key?: string; secret?: string } {
  return {
    key: process.env.APCA_API_KEY_ID ?? process.env.ALPACA_API_KEY,
    secret: process.env.APCA_API_SECRET_KEY ?? process.env.ALPACA_API_SECRET,
  };
}

export function alpacaConfigured(): boolean {
  const { key, secret } = alpacaKeys();
  return Boolean(key && secret);
}

export async function alpaca<T>(path: string, init?: RequestInit): Promise<T> {
  const { key, secret } = alpacaKeys();
  if (!key || !secret) {
    throw new AlpacaError(
      "Alpaca API keys are not configured (set APCA_API_KEY_ID/APCA_API_SECRET_KEY or ALPACA_API_KEY/ALPACA_API_SECRET in .env.local)",
      501,
    );
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new AlpacaError(msg || `Alpaca error ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Alpaca market-data API (separate host from the trading API). */
const DATA_BASE_URL = "https://data.alpaca.markets";

export function alpacaDataFeed(): string {
  return process.env.ALPACA_DATA_FEED ?? "iex";
}

export async function alpacaData<T>(path: string, feed?: string): Promise<T> {
  const { key, secret } = alpacaKeys();
  if (!key || !secret) {
    throw new AlpacaError("Alpaca API keys are not configured", 501);
  }
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${DATA_BASE_URL}${path}${sep}feed=${feed ?? alpacaDataFeed()}`, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new AlpacaError(msg || `Alpaca data error ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/**
 * Alpaca market-data API call without the `feed` param — for /v1beta1/*
 * endpoints (screener, news) that don't accept it.
 */
export async function alpacaDataRaw<T>(path: string): Promise<T> {
  const { key, secret } = alpacaKeys();
  if (!key || !secret) {
    throw new AlpacaError("Alpaca API keys are not configured", 501);
  }
  const res = await fetch(`${DATA_BASE_URL}${path}`, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new AlpacaError(msg || `Alpaca data error ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export class AlpacaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
