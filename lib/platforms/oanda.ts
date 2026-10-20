/**
 * OANDA v20 REST API client.
 * Auth: personal access token sent as `Authorization: Bearer <token>` on
 * every request — no session/login step. Practice and live accounts use
 * different hosts (api-fxpractice vs api-fxtrade).
 * Docs: https://developer.oanda.com/rest-live-v20/introduction/
 */

export interface OandaCreds {
  apiToken: string;
  accountId: string;
  baseUrl: string; // practice or live
}

export interface OandaAccountSummary {
  account: {
    balance: string;
    unrealizedPL: string;
    NAV: string;
    currency: string;
    alias?: string;
  };
}

export interface OandaPositionSide {
  units: string;
  averagePrice?: string;
  unrealizedPL?: string;
}

export interface OandaPosition {
  instrument: string;
  long: OandaPositionSide;
  short: OandaPositionSide;
}

export interface OandaOrderArgs {
  instrument: string;
  units: number;
  type: "MARKET" | "LIMIT" | "STOP";
  price?: number;
  stopLossOnFill?: { price: string };
  takeProfitOnFill?: { price: string };
  timeInForce?: string;
}

export interface OandaOrderResult {
  orderFillTransaction?: { id: string };
  orderCreateTransaction?: { id: string };
}

interface OandaOpenPositionsResponse {
  positions: OandaPosition[];
}

const DEFAULT_BASE_URL = "https://api-fxpractice.oanda.com";

/** Server-side credentials from env (OANDA_*). */
export function oandaCreds(): OandaCreds | null {
  const apiToken = process.env.OANDA_API_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!apiToken || !accountId) return null;
  return {
    apiToken,
    accountId,
    baseUrl: process.env.OANDA_BASE_URL ?? DEFAULT_BASE_URL,
  };
}

/**
 * Resolve OANDA creds for a request: the caller's own admin-managed
 * trading account (platform "oanda", apiKey = personal access token,
 * apiSecret = account id) first, then env-var creds as the shared
 * fallback.
 */
export async function oandaUserCreds(uid: string | null): Promise<OandaCreds | null> {
  if (uid) {
    const { storeList } = await import("@/lib/store");
    const accounts = await storeList<{
      platform: string;
      ownerUid?: string;
      apiKey?: string;
      apiSecret?: string;
    }>("users.json");
    const mine = accounts.find(
      (a) => a.platform === "oanda" && a.ownerUid === uid && a.apiKey && a.apiSecret,
    );
    if (mine?.apiKey && mine.apiSecret) {
      return {
        apiToken: mine.apiKey,
        accountId: mine.apiSecret,
        baseUrl: process.env.OANDA_BASE_URL ?? DEFAULT_BASE_URL,
      };
    }
  }
  return oandaCreds();
}

async function oandaReq<T>(
  creds: OandaCreds,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.apiToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new Error("OANDA auth rejected — check OANDA_API_TOKEN / OANDA_ACCOUNT_ID.");
    throw new Error(`OANDA ${method} ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  // Some OANDA endpoints (e.g. closes) may return an empty body on success.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function oandaGet<T>(creds: OandaCreds, path: string): Promise<T> {
  return oandaReq<T>(creds, "GET", path);
}

/** Balance, NAV and unrealized P/L snapshot (the main connectivity probe). */
export async function oandaAccountSummary(creds: OandaCreds): Promise<OandaAccountSummary> {
  return oandaGet<OandaAccountSummary>(
    creds,
    `/v3/accounts/${encodeURIComponent(creds.accountId)}/summary`,
  );
}

/** Net open positions (long/short sides per instrument). */
export async function oandaOpenPositions(creds: OandaCreds): Promise<OandaPosition[]> {
  const data = await oandaGet<OandaOpenPositionsResponse>(
    creds,
    `/v3/accounts/${encodeURIComponent(creds.accountId)}/openPositions`,
  );
  return data.positions;
}

/** Place a MARKET / LIMIT / STOP order. Positive units = buy, negative = sell. */
export async function oandaPlaceOrder(
  creds: OandaCreds,
  args: OandaOrderArgs,
): Promise<OandaOrderResult> {
  const order: Record<string, unknown> = {
    instrument: args.instrument,
    units: String(args.units),
    type: args.type,
    timeInForce: args.timeInForce ?? (args.type === "MARKET" ? "FOK" : "GTC"),
  };
  if (args.price !== undefined) order.price = String(args.price);
  if (args.stopLossOnFill) order.stopLossOnFill = args.stopLossOnFill;
  if (args.takeProfitOnFill) order.takeProfitOnFill = args.takeProfitOnFill;

  return oandaReq<OandaOrderResult>(
    creds,
    "POST",
    `/v3/accounts/${encodeURIComponent(creds.accountId)}/orders`,
    { order },
  );
}

/**
 * Close a position side — fully (units omitted → "ALL") or partially.
 * PUT /v3/accounts/{id}/positions/{instrument}/close
 */
export async function oandaClosePosition(
  creds: OandaCreds,
  instrument: string,
  side: "long" | "short",
  units?: number,
): Promise<void> {
  const unitsValue = units === undefined ? "ALL" : String(units);
  const body = side === "long" ? { longUnits: unitsValue } : { shortUnits: unitsValue };
  await oandaReq<unknown>(
    creds,
    "PUT",
    `/v3/accounts/${encodeURIComponent(creds.accountId)}/positions/${encodeURIComponent(instrument)}/close`,
    body,
  );
}

/**
 * Close an individual trade — fully or partially.
 * PUT /v3/accounts/{id}/trades/{tradeId}/close
 */
export async function oandaCloseTrade(
  creds: OandaCreds,
  tradeId: string,
  units?: number,
): Promise<void> {
  await oandaReq<unknown>(
    creds,
    "PUT",
    `/v3/accounts/${encodeURIComponent(creds.accountId)}/trades/${encodeURIComponent(tradeId)}/close`,
    { units: units === undefined ? "ALL" : String(units) },
  );
}
