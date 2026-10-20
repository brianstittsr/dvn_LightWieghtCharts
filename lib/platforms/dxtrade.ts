/**
 * Server-side DXTrade REST API client (Devexperts DXtrade).
 *
 * Auth: POST {baseUrl}/login with {username, password, vendor/domain}
 *       → sessionToken, then send `Authorization: DXAPI {sessionToken}`
 *       on every subsequent request.
 *
 * Each prop firm/broker runs its own DXTrade deployment, so `baseUrl` is
 * configurable per account (e.g. https://dx.velotrade.com/dxsca-web).
 */

export interface DxTradeCreds {
  userName: string;
  password: string;
  baseUrl: string; // broker-specific DXTrade deployment URL
  vendor?: string; // optional vendor/domain identifier
}

export interface DxTradeAccount {
  accountCode: string;
  accountType?: string;
  currency?: string;
}

export interface DxTradePosition {
  positionCode: string;
  instrument: string;
  side: "BUY" | "SELL";
  quantity: number;
  averagePrice: number;
  unrealizedPL?: number;
}

export interface DxTradeOrderArgs {
  accountCode: string;
  instrument: string;
  side: "BUY" | "SELL";
  quantity: number;
  type: "MARKET" | "LIMIT" | "STOP";
  limitPrice?: number;
  stopPrice?: number;
  positionEffect?: "OPEN" | "CLOSE";
  positionCode?: string; // for closing specific positions
  timeInForce?: string;
}

interface LoginResponse {
  sessionToken?: string;
  timeout?: number;
  errorCode?: string;
  errorMsg?: string;
}

interface AccountsEnvelope {
  accounts?: DxTradeAccount[];
}

interface PositionsEnvelope {
  positions?: DxTradePosition[];
}

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function cacheKey(creds: DxTradeCreds): string {
  return `${normalizeBaseUrl(creds.baseUrl)}|${creds.userName}`;
}

/** Server-side credentials from env (DXTRADE_*). */
export function dxtradeCreds(): DxTradeCreds | null {
  const userName = process.env.DXTRADE_USERNAME;
  const password = process.env.DXTRADE_PASSWORD;
  const baseUrl = process.env.DXTRADE_BASE_URL;
  if (!userName || !password || !baseUrl) return null;
  return {
    userName,
    password,
    baseUrl: normalizeBaseUrl(baseUrl),
    vendor: process.env.DXTRADE_VENDOR,
  };
}

/**
 * Resolve DXTrade creds for a request: the caller's admin-managed account
 * (platform "dxtrade", apiKey = username, apiSecret = password,
 * appKey = baseUrl) first, then env-var creds as the shared fallback.
 */
export async function dxtradeUserCreds(uid: string | null): Promise<DxTradeCreds | null> {
  if (uid) {
    const { storeList } = await import("@/lib/store");
    const accounts = await storeList<{
      platform: string;
      ownerUid?: string;
      apiKey?: string;
      apiSecret?: string;
      appKey?: string;
      vendor?: string;
    }>("users.json");
    const mine = accounts.find(
      (a) =>
        a.platform === "dxtrade" &&
        a.ownerUid === uid &&
        a.apiKey &&
        a.apiSecret &&
        a.appKey,
    );
    if (mine?.apiKey && mine.apiSecret && mine.appKey) {
      return {
        userName: mine.apiKey,
        password: mine.apiSecret,
        baseUrl: normalizeBaseUrl(mine.appKey),
        vendor: mine.vendor ?? process.env.DXTRADE_VENDOR,
      };
    }
  }
  return dxtradeCreds();
}

/** Create or reuse a cached session token. */
export async function dxtradeLogin(creds: DxTradeCreds): Promise<string> {
  const key = cacheKey(creds);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const res = await fetch(`${normalizeBaseUrl(creds.baseUrl)}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username: creds.userName,
      password: creds.password,
      domain: creds.vendor,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `DXTrade auth rejected — check DXTRADE_USERNAME / DXTRADE_PASSWORD / DXTRADE_BASE_URL.`,
      );
    }
    throw new Error(`DXTrade login failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as LoginResponse;
  if (!data.sessionToken) {
    throw new Error(
      `DXTrade login rejected (${data.errorCode ?? "?"}: ${data.errorMsg ?? "no session token"}).`,
    );
  }

  tokenCache.set(key, { token: data.sessionToken, expiresAt: Date.now() + TOKEN_TTL_MS });
  return data.sessionToken;
}

async function dxGet<T>(creds: DxTradeCreds, session: string, path: string): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(creds.baseUrl)}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `DXAPI ${session}`,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`DXTrade ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

async function dxPost<T>(
  creds: DxTradeCreds,
  session: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(creds.baseUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `DXAPI ${session}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`DXTrade ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

/** List trading accounts for the authenticated user. */
export async function dxtradeAccounts(
  creds: DxTradeCreds,
  session: string,
): Promise<DxTradeAccount[]> {
  const data = (await dxGet<unknown>(creds, session, "/accounts")) as
    | DxTradeAccount[]
    | AccountsEnvelope;
  if (Array.isArray(data)) return data;
  return (data as AccountsEnvelope).accounts ?? [];
}

/** List positions for a single account. */
export async function dxtradePositions(
  creds: DxTradeCreds,
  session: string,
  accountCode: string,
): Promise<DxTradePosition[]> {
  const data = (await dxGet<unknown>(
    creds,
    session,
    `/accounts/${encodeURIComponent(accountCode)}/positions`,
  )) as DxTradePosition[] | PositionsEnvelope;
  if (Array.isArray(data)) return data;
  return (data as PositionsEnvelope).positions ?? [];
}

/** Place an order on the given account. */
export async function dxtradePlaceOrder(
  creds: DxTradeCreds,
  session: string,
  args: DxTradeOrderArgs,
): Promise<{ orderCode?: string }> {
  const { accountCode, ...orderBody } = args;
  return dxPost<{ orderCode?: string }>(
    creds,
    session,
    `/accounts/${encodeURIComponent(accountCode)}/orders`,
    orderBody,
  );
}

/**
 * Close a position (partial or full) by submitting an opposing-side
 * market order with `positionEffect: "CLOSE"`.
 */
export async function dxtradeClosePosition(
  creds: DxTradeCreds,
  session: string,
  accountCode: string,
  positionCode: string,
  instrument: string,
  side: "BUY" | "SELL",
  size: number,
  closeQty?: number,
): Promise<void> {
  const closeSide = side === "BUY" ? "SELL" : "BUY";
  const quantity = closeQty ?? size;
  await dxtradePlaceOrder(creds, session, {
    accountCode,
    instrument,
    side: closeSide,
    quantity,
    type: "MARKET",
    positionEffect: "CLOSE",
    positionCode,
  });
}
