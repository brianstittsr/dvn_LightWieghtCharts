/**
 * Match-Trader REST API client (Match-Trade Technologies).
 *
 * Auth: POST /manager/co-login with {email, password, brokerId}
 *   → JWT cookies: co-auth (15 min) + per-account tradingApiToken.
 * Subsequent calls need:
 *   Cookie: co-auth=<token>
 *   Auth-trading-api: <tradingApiToken>
 *
 * Base URL is per-broker deployment (e.g. https://mtr-broker.match-trade.com).
 */

export interface MatchTraderCreds {
  email: string;
  password: string;
  brokerId: string;
  baseUrl: string;
}

export interface MatchTraderSession {
  coAuth: string;
  tradingApiToken: string;
  systemUuid: string;
}

export interface MatchTraderAccount {
  email?: string;
  balance?: number;
  equity?: number;
  currency?: string;
}

export interface MatchTraderPosition {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  openPrice: number;
  profit?: number;
}

export interface MatchTraderOrderArgs {
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  type?: "MARKET" | "LIMIT" | "STOP";
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface LoginResponse {
  uuid?: string;
  coAuth?: string;
  tradingApiToken?: string;
  tradingAccounts?: { tradingApiToken?: string; uuid?: string }[];
  error?: string;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;
const sessionCache = new Map<string, { session: MatchTraderSession; expiresAt: number }>();

/** Server-side credentials from env. */
export function matchtradeCreds(): MatchTraderCreds | null {
  const email = process.env.MATCHTRADE_EMAIL;
  const password = process.env.MATCHTRADE_PASSWORD;
  const brokerId = process.env.MATCHTRADE_BROKER_ID;
  const baseUrl = process.env.MATCHTRADE_BASE_URL;
  if (!email || !password || !brokerId || !baseUrl) return null;
  return { email, password, brokerId, baseUrl: baseUrl.replace(/\/+$/, "") };
}

/**
 * Per-user creds: apiKey = email, apiSecret = password,
 * appKey = baseUrl, notes or extra field = brokerId.
 */
export async function matchtradeUserCreds(uid: string | null): Promise<MatchTraderCreds | null> {
  if (uid) {
    const { storeList } = await import("@/lib/store");
    const accounts = await storeList<{
      platform: string;
      ownerUid?: string;
      apiKey?: string;
      apiSecret?: string;
      appKey?: string;
      notes?: string;
    }>("users.json");
    const mine = accounts.find(
      (a) =>
        a.platform === "matchtrade" &&
        a.ownerUid === uid &&
        a.apiKey &&
        a.apiSecret &&
        a.appKey,
    );
    if (mine?.apiKey && mine.apiSecret && mine.appKey) {
      return {
        email: mine.apiKey,
        password: mine.apiSecret,
        baseUrl: mine.appKey.replace(/\/+$/, ""),
        brokerId: mine.notes ?? process.env.MATCHTRADE_BROKER_ID ?? "",
      };
    }
  }
  return matchtradeCreds();
}

/** Login and cache the dual-token session. */
export async function matchtradeLogin(creds: MatchTraderCreds): Promise<MatchTraderSession> {
  const key = `${creds.baseUrl}|${creds.email}`;
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.session;

  const res = await fetch(`${creds.baseUrl}/manager/co-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: creds.email,
      password: creds.password,
      brokerId: creds.brokerId,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new Error("Match-Trader auth rejected — check credentials and brokerId.");
    throw new Error(`Match-Trader login failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as LoginResponse;

  // Extract co-auth from set-cookie header or response body
  let coAuth = data.coAuth ?? "";
  if (!coAuth) {
    const cookies = res.headers.get("set-cookie") ?? "";
    const match = cookies.match(/co-auth=([^;]+)/);
    if (match) coAuth = match[1];
  }

  const tradingApiToken =
    data.tradingApiToken ?? data.tradingAccounts?.[0]?.tradingApiToken ?? "";
  const systemUuid = data.uuid ?? data.tradingAccounts?.[0]?.uuid ?? "";

  if (!coAuth || !tradingApiToken) {
    throw new Error("Match-Trader login did not return auth tokens.");
  }

  const session: MatchTraderSession = { coAuth, tradingApiToken, systemUuid };
  sessionCache.set(key, { session, expiresAt: Date.now() + TOKEN_TTL_MS });
  return session;
}

async function mtrFetch<T>(
  creds: MatchTraderCreds,
  session: MatchTraderSession,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `co-auth=${session.coAuth}`,
      "Auth-trading-api": session.tradingApiToken,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Match-Trader ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Account balance/equity probe. */
export async function matchtradeBalance(
  creds: MatchTraderCreds,
  session: MatchTraderSession,
): Promise<MatchTraderAccount> {
  const prefix = session.systemUuid ? `/mtr-api/${session.systemUuid}` : "";
  return mtrFetch<MatchTraderAccount>(creds, session, "GET", `${prefix}/get-balance`);
}

/** Open positions. */
export async function matchtradePositions(
  creds: MatchTraderCreds,
  session: MatchTraderSession,
): Promise<MatchTraderPosition[]> {
  const prefix = session.systemUuid ? `/mtr-api/${session.systemUuid}` : "";
  const data = await mtrFetch<MatchTraderPosition[] | { positions?: MatchTraderPosition[] }>(
    creds,
    session,
    "GET",
    `${prefix}/opened-positions`,
  );
  return Array.isArray(data) ? data : (data.positions ?? []);
}

/** Open a new position. */
export async function matchtradeOpenPosition(
  creds: MatchTraderCreds,
  session: MatchTraderSession,
  args: MatchTraderOrderArgs,
): Promise<{ id?: string }> {
  const prefix = session.systemUuid ? `/mtr-api/${session.systemUuid}` : "";
  return mtrFetch<{ id?: string }>(creds, session, "POST", `${prefix}/open-position`, args);
}

/** Full close — close entire position(s) by id. */
export async function matchtradeClosePosition(
  creds: MatchTraderCreds,
  session: MatchTraderSession,
  positionId: string,
): Promise<void> {
  const prefix = session.systemUuid ? `/mtr-api/${session.systemUuid}` : "";
  await mtrFetch<unknown>(creds, session, "POST", `${prefix}/close-positions`, {
    positionIds: [positionId],
  });
}

/** Partial close — reduce an open position. */
export async function matchtradePartialClose(
  creds: MatchTraderCreds,
  session: MatchTraderSession,
  positionId: string,
  volume: number,
): Promise<void> {
  const prefix = session.systemUuid ? `/mtr-api/${session.systemUuid}` : "";
  await mtrFetch<unknown>(creds, session, "POST", `${prefix}/partial-close`, {
    positionId,
    volume,
  });
}
