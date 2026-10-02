/**
 * ProjectX API client — shared by TopStep and Apex Trader Funding
 * (both run on the ProjectX gateway stack). Auth: POST /api/Auth/loginKey
 * with { userName, apiKey } → short-lived Bearer token.
 */

export interface ProjectXCreds {
  userName: string;
  apiKey: string;
  baseUrl: string;
}

export interface ProjectXAccount {
  id: number;
  name: string;
  balance: number;
  canTrade: boolean;
  isVisible: boolean;
}

interface LoginKeyResponse {
  token?: string;
  success?: boolean;
  errorMessage?: string;
}

interface SearchResponse<T> {
  success: boolean;
  accounts?: T[];
  positions?: T[];
  errorCode?: number;
  errorMessage?: string;
}

async function pxFetch<T>(
  creds: ProjectXCreds,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ProjectX ${res.status}`);
  return (await res.json()) as T;
}

export async function projectxLogin(creds: ProjectXCreds): Promise<string> {
  const r = await pxFetch<LoginKeyResponse>(creds, "/api/Auth/loginKey", null, {
    userName: creds.userName,
    apiKey: creds.apiKey,
  });
  if (!r.success || !r.token) {
    throw new Error(r.errorMessage ?? "ProjectX auth failed");
  }
  return r.token;
}

export async function projectxAccounts(
  creds: ProjectXCreds,
  token: string,
): Promise<ProjectXAccount[]> {
  const r = await pxFetch<SearchResponse<ProjectXAccount>>(creds, "/api/Account/search", token, {
    onlyActiveAccounts: true,
  });
  if (!r.success) throw new Error(r.errorMessage ?? "Account search failed");
  return r.accounts ?? [];
}

// ── Trading endpoints ────────────────────────────────────────────────────────

/** ProjectX OrderType enum. */
export const PX_ORDER_TYPE = {
  Limit: 1,
  Market: 2,
  Stop: 4,
  TrailingStop: 5,
  JoinBid: 6,
  JoinAsk: 7,
} as const;

/** ProjectX OrderSide enum. */
export const PX_SIDE = { Buy: 0, Sell: 1 } as const;

/** Position type: 1 = Long, 2 = Short. */
export interface ProjectXPosition {
  id: number;
  accountId: number;
  contractId: string;
  type: 1 | 2;
  size: number;
  averagePrice: number;
}

export interface ProjectXContract {
  id: string;
  name: string;
  description: string;
  symbolId: string;
  tickSize: number;
  tickValue: number;
}

export interface ProjectXOrder {
  id: number;
  accountId: number;
  contractId: string;
  type: number;
  side: number;
  size: number;
  status: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
}

export interface ProjectXBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Cached login tokens keyed by gateway+username (tokens last ~24h; refresh at 20h). */
const tokenCache = new Map<string, { token: string; exp: number }>();

export async function projectxToken(creds: ProjectXCreds): Promise<string> {
  const key = `${creds.baseUrl}:${creds.userName}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.token;
  const token = await projectxLogin(creds);
  tokenCache.set(key, { token, exp: Date.now() + 20 * 60 * 60 * 1000 });
  return token;
}

export async function projectxContracts(
  creds: ProjectXCreds,
  searchText: string,
): Promise<ProjectXContract[]> {
  const r = await pxFetch<SearchResponse<ProjectXContract> & { contracts?: ProjectXContract[] }>(
    creds,
    "/api/Contract/search",
    await projectxToken(creds),
    { live: false, searchText },
  );
  if (!r.success) throw new Error(r.errorMessage ?? "Contract search failed");
  return r.contracts ?? [];
}

export async function projectxOpenPositions(
  creds: ProjectXCreds,
  accountId: number,
): Promise<ProjectXPosition[]> {
  const r = await pxFetch<SearchResponse<ProjectXPosition>>(
    creds,
    "/api/Position/searchOpen",
    await projectxToken(creds),
    { accountId },
  );
  if (!r.success) throw new Error(r.errorMessage ?? "Position search failed");
  return r.positions ?? [];
}

export async function projectxOpenOrders(
  creds: ProjectXCreds,
  accountId: number,
): Promise<ProjectXOrder[]> {
  const r = await pxFetch<SearchResponse<ProjectXOrder> & { orders?: ProjectXOrder[] }>(
    creds,
    "/api/Order/searchOpen",
    await projectxToken(creds),
    { accountId },
  );
  if (!r.success) throw new Error(r.errorMessage ?? "Order search failed");
  return r.orders ?? [];
}

export interface PlaceOrderArgs {
  accountId: number;
  contractId: string;
  type: number;
  side: number;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  /** Bracket legs in ticks — TP is a limit, SL is a stop. */
  takeProfitTicks?: number;
  stopLossTicks?: number;
  customTag?: string;
}

export async function projectxPlaceOrder(
  creds: ProjectXCreds,
  args: PlaceOrderArgs,
): Promise<{ orderId: number }> {
  const body: Record<string, unknown> = {
    accountId: args.accountId,
    contractId: args.contractId,
    type: args.type,
    side: args.side,
    size: args.size,
  };
  if (args.limitPrice != null) body.limitPrice = args.limitPrice;
  if (args.stopPrice != null) body.stopPrice = args.stopPrice;
  if (args.customTag) body.customTag = args.customTag;
  if (args.takeProfitTicks) {
    body.takeProfitBracket = { ticks: args.takeProfitTicks, type: PX_ORDER_TYPE.Limit };
  }
  if (args.stopLossTicks) {
    body.stopLossBracket = { ticks: args.stopLossTicks, type: PX_ORDER_TYPE.Stop };
  }
  const r = await pxFetch<
    SearchResponse<never> & { orderId?: number }
  >(creds, "/api/Order/place", await projectxToken(creds), body);
  if (!r.success || r.orderId == null) {
    throw new Error(r.errorMessage ?? `Order rejected (code ${r.errorCode ?? "?"})`);
  }
  return { orderId: r.orderId };
}

export async function projectxCancelOrder(
  creds: ProjectXCreds,
  accountId: number,
  orderId: number,
): Promise<void> {
  const r = await pxFetch<SearchResponse<never>>(creds, "/api/Order/cancel", await projectxToken(creds), {
    accountId,
    orderId,
  });
  if (!r.success) throw new Error(r.errorMessage ?? "Cancel failed");
}

export async function projectxCloseContract(
  creds: ProjectXCreds,
  accountId: number,
  contractId: string,
): Promise<void> {
  const r = await pxFetch<SearchResponse<never>>(
    creds,
    "/api/Position/closeContract",
    await projectxToken(creds),
    { accountId, contractId },
  );
  if (!r.success) throw new Error(r.errorMessage ?? "Close failed");
}

/** Last traded price from the most recent 1-minute bar (REST has no quote stream). */
export async function projectxLastPrice(
  creds: ProjectXCreds,
  contractId: string,
): Promise<number | null> {
  const now = Date.now();
  const r = await pxFetch<SearchResponse<never> & { bars?: ProjectXBar[] }>(
    creds,
    "/api/History/retrieveBars",
    await projectxToken(creds),
    {
      contractId,
      live: false,
      startTime: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now).toISOString(),
      unit: 3, // minutes
      unitNumber: 1,
      limit: 1,
      includePartialBar: true,
    },
  );
  if (!r.success) throw new Error(r.errorMessage ?? "History request failed");
  return r.bars?.length ? r.bars[r.bars.length - 1].c : null;
}

export function topstepCreds(): ProjectXCreds | null {
  const userName = process.env.TOPSTEP_USERNAME;
  const apiKey = process.env.TOPSTEP_API_KEY;
  if (!userName || !apiKey) return null;
  return {
    userName,
    apiKey,
    baseUrl: process.env.TOPSTEP_BASE_URL ?? "https://api.topstepx.com",
  };
}

export const FUTURES_PLATFORMS = ["topstep", "apex"] as const;
export type FuturesPlatform = (typeof FUTURES_PLATFORMS)[number];

export function credsFor(platform: string): ProjectXCreds | null {
  if (platform === "topstep") return topstepCreds();
  if (platform === "apex") return apexCreds();
  return null;
}

export function apexCreds(): ProjectXCreds | null {
  const userName = process.env.APEX_USERNAME;
  const apiKey = process.env.APEX_API_KEY;
  if (!userName || !apiKey) return null;
  return {
    userName,
    apiKey,
    baseUrl: process.env.APEX_BASE_URL ?? "https://api.apextraderfunding.com",
  };
}
