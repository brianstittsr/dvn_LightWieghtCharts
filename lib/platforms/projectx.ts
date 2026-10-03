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

/** loginKey errorCode → actionable message (per ProjectX docs). */
const LOGIN_ERRORS: Record<number, string> = {
  3: "Invalid credentials — userName must be your platform login name (NOT your email), and the API key must be copied exactly from Settings > API.",
  7: "Pending agreements — sign in to the trading platform and accept the required agreements first.",
  9: "No active API subscription with your firm.",
  10: "Your firm has API key authentication disabled — contact them.",
};

export async function projectxLogin(creds: ProjectXCreds): Promise<string> {
  const r = await pxFetch<LoginKeyResponse & { errorCode?: number }>(
    creds,
    "/api/Auth/loginKey",
    null,
    { userName: creds.userName, apiKey: creds.apiKey },
  );
  if (!r.success || !r.token) {
    throw new Error(
      r.errorMessage ?? LOGIN_ERRORS[r.errorCode ?? -1] ?? `ProjectX auth failed (code ${r.errorCode ?? "?"})`,
    );
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
  /** Present on search results — marks the front month. */
  activeContract?: boolean;
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
  // Empty query → browse all available contracts (per docs' "placing your first order").
  const path = searchText ? "/api/Contract/search" : "/api/Contract/available";
  const body = searchText ? { live: false, searchText } : { live: false };
  const r = await pxFetch<SearchResponse<ProjectXContract> & { contracts?: ProjectXContract[] }>(
    creds,
    path,
    await projectxToken(creds),
    body,
  );
  if (!r.success) throw new Error(r.errorMessage ?? "Contract search failed");
  return r.contracts ?? [];
}

/**
 * Resolve a futures root ("NQ", "MNQ", "ES", …) to its front-month ProjectX
 * contractId. Matches contract names that START with the root (so "NQ" does
 * not match "MNQH26") and prefers the API's activeContract flag. Results are
 * cached per creds+root for the process lifetime.
 */
const frontContractCache = new Map<string, ProjectXContract>();

export async function resolveFrontContract(
  creds: ProjectXCreds,
  root: string,
): Promise<ProjectXContract> {
  const key = `${creds.baseUrl}:${creds.userName}:${root}`;
  const hit = frontContractCache.get(key);
  if (hit) return hit;

  const up = root.toUpperCase();
  const all = await projectxContracts(creds, up);
  const matches = all.filter(
    (c) =>
      c.name.toUpperCase().startsWith(up) ||
      c.symbolId.toUpperCase().endsWith(`.${up}`),
  );
  const pool = matches.length > 0 ? matches : all;
  const front =
    pool.find((c) => c.activeContract === true) ??
    pool.find((c) => c.name.toUpperCase().startsWith(up)) ??
    pool[0];
  if (!front) throw new Error(`No contract found for ${root}`);
  frontContractCache.set(key, front);
  return front;
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

/** Filled order history for P&L (ProjectX OrderStatus: 2 = Filled). */
export interface ProjectXHistoryOrder {
  id: number;
  contractId: string;
  side: number;
  size: number;
  status: number;
  fillVolume?: number;
  filledPrice?: number | null;
  avgFillPrice?: number | null;
  updateTimestamp?: string;
  creationTimestamp?: string;
}

export async function projectxOrderHistory(
  creds: ProjectXCreds,
  accountId: number,
  startIso: string,
  endIso: string,
): Promise<ProjectXHistoryOrder[]> {
  const r = await pxFetch<SearchResponse<never> & { orders?: ProjectXHistoryOrder[] }>(
    creds,
    "/api/Order/search",
    await projectxToken(creds),
    { accountId, startTimestamp: startIso, endTimestamp: endIso },
  );
  if (!r.success) throw new Error(r.errorMessage ?? "Order history failed");
  return r.orders ?? [];
}

/** ProjectX AggregateBarUnit enum. */
export const PX_BAR_UNIT = { Second: 1, Minute: 2, Hour: 3, Day: 4, Week: 5, Month: 6 } as const;

export async function projectxBars(
  creds: ProjectXCreds,
  contractId: string,
  unit: number,
  unitNumber: number,
  lookbackMs: number,
  limit = 500,
): Promise<ProjectXBar[]> {
  const now = Date.now();
  const r = await pxFetch<SearchResponse<never> & { bars?: ProjectXBar[] }>(
    creds,
    "/api/History/retrieveBars",
    await projectxToken(creds),
    {
      contractId,
      live: false,
      startTime: new Date(now - lookbackMs).toISOString(),
      endTime: new Date(now).toISOString(),
      unit,
      unitNumber,
      limit,
      includePartialBar: true,
    },
  );
  if (!r.success) throw new Error(r.errorMessage ?? "History request failed");
  return r.bars ?? [];
}

/** Contract detail (tickSize/tickValue needed for points→ticks conversion). */
export async function projectxContractById(
  creds: ProjectXCreds,
  contractId: string,
): Promise<ProjectXContract | null> {
  const r = await pxFetch<
    SearchResponse<never> & { contract?: ProjectXContract }
  >(creds, "/api/Contract/searchById", await projectxToken(creds), {
    contractId,
  });
  if (!r.success) throw new Error(r.errorMessage ?? "Contract lookup failed");
  return r.contract ?? null;
}

/** Last traded price from the most recent 1-minute bar (REST has no quote stream). */
export async function projectxLastPrice(
  creds: ProjectXCreds,
  contractId: string,
): Promise<number | null> {
  const bars = await projectxBars(creds, contractId, PX_BAR_UNIT.Minute, 1, 24 * 60 * 60 * 1000, 1);
  return bars.length ? bars[bars.length - 1].c : null;
}

/** Most recent 1m bar (price + its timestamp, for staleness checks). */
export async function projectxLastBar(
  creds: ProjectXCreds,
  contractId: string,
): Promise<ProjectXBar | null> {
  const bars = await projectxBars(creds, contractId, PX_BAR_UNIT.Minute, 1, 24 * 60 * 60 * 1000, 1);
  return bars.length ? bars[bars.length - 1] : null;
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

/** Creds + the account to trade on, resolved for a request. */
export interface ResolvedProjectX {
  creds: ProjectXCreds;
  /** Preferred ProjectX account id — linked record, then env override. */
  accountId?: number;
}

function envAccountId(platform: string): number | undefined {
  const raw =
    platform === "apex" ? process.env.APEX_ACCOUNT_ID : process.env.TOPSTEP_ACCOUNT_ID;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Resolve ProjectX creds for a request: the caller's own admin-managed account
 * (matched by Firebase uid) first, then env-var creds as the shared fallback.
 * For ProjectX platforms the account's `apiKey` field holds the platform
 * username and `apiSecret` holds the ProjectX API key; `accountId` pins which
 * eval/funded account orders route to (else the ticket's account picker).
 */
export async function userCredsFor(
  platform: string,
  uid: string | null,
): Promise<ResolvedProjectX | null> {
  if (uid) {
    const { readJson } = await import("@/lib/server-store");
    const accounts = await readJson<
      {
        platform: string;
        ownerUid?: string;
        accountId?: number;
        apiKey?: string;
        apiSecret?: string;
      }[]
    >("users.json", []);
    const mine = accounts.find(
      (a) => a.platform === platform && a.ownerUid === uid && a.apiKey && a.apiSecret,
    );
    if (mine?.apiKey && mine.apiSecret) {
      const base = credsFor(platform);
      return {
        creds: {
          userName: mine.apiKey,
          apiKey: mine.apiSecret,
          baseUrl: base?.baseUrl ?? defaultBaseUrl(platform),
        },
        accountId: mine.accountId ?? envAccountId(platform),
      };
    }
  }
  const creds = credsFor(platform);
  return creds ? { creds, accountId: envAccountId(platform) } : null;
}

function defaultBaseUrl(platform: string): string {
  return platform === "apex"
    ? "https://api.apextraderfunding.com"
    : "https://api.topstepx.com";
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
