/**
 * FOREX.com REST API client — GAIN Capital / CityIndex TradingAPI.
 * Auth: POST /Session with { UserName, Password, AppKey } → session token,
 * echoed back as `UserName` + `Session` headers on subsequent calls.
 * Live and demo accounts share the same gateway host.
 * Docs: https://www.forex.com/en/trading-tools/api-trading/
 */

export interface ForexCreds {
  userName: string;
  password: string;
  appKey: string;
  baseUrl: string;
}

export interface ForexTradingAccount {
  TradingAccountId: number;
  TradingAccountType?: string;
  TradingAccountStatus?: string;
}

export interface ForexClientAccount {
  LogonUserName?: string;
  ClientAccountId: number;
  TradingAccounts?: ForexTradingAccount[];
}

export interface ForexMargin {
  Cash?: number;
  Margin?: number;
  MarginIndicator?: number;
  NetEquity?: number;
  OpenTradeEquity?: number;
  TradeableFunds?: number;
  TotalMarginRequirement?: number;
  CurrencyISOCode?: string;
}

interface SessionResponse {
  Session?: string;
  StatusCode?: number;
  StatusReason?: string;
}

/** Server-side credentials from env (FOREX_*). */
export function forexCreds(): ForexCreds | null {
  const userName = process.env.FOREX_USERNAME;
  const password = process.env.FOREX_PASSWORD;
  const appKey = process.env.FOREX_APP_KEY;
  if (!userName || !password || !appKey) return null;
  return {
    userName,
    password,
    appKey,
    baseUrl: process.env.FOREX_BASE_URL ?? "https://ciapi.cityindex.com/TradingAPI",
  };
}

async function forexGet<T>(creds: ForexCreds, session: string, path: string): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      UserName: creds.userName,
      Session: session,
      AppKey: creds.appKey,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FOREX.com ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

/** Create a session → token for subsequent calls (throws on bad creds). */
export async function forexSession(creds: ForexCreds): Promise<string> {
  const res = await fetch(`${creds.baseUrl}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      UserName: creds.userName,
      Password: creds.password,
      AppKey: creds.appKey,
      AppVersion: "1",
      AppComments: "",
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new Error("FOREX.com auth rejected — check FOREX_USERNAME / FOREX_PASSWORD / FOREX_APP_KEY.");
    throw new Error(`FOREX.com session failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as SessionResponse;
  if (!data.Session)
    throw new Error(`FOREX.com session rejected (${data.StatusReason ?? `status ${data.StatusCode ?? "?"}`}).`);
  return data.Session;
}

/** Client account id + linked trading accounts (the main connectivity probe). */
export async function forexClientAccount(
  creds: ForexCreds,
  session: string,
): Promise<ForexClientAccount> {
  return forexGet<ForexClientAccount>(creds, session, "/useraccount/ClientAndTradingAccount");
}

/** Equity/cash snapshot for a client account. */
export async function forexClientMargin(
  creds: ForexCreds,
  session: string,
  clientAccountId: number,
): Promise<ForexMargin> {
  return forexGet<ForexMargin>(
    creds,
    session,
    `/margin/clientAccountMargin?clientAccountId=${encodeURIComponent(clientAccountId)}`,
  );
}
