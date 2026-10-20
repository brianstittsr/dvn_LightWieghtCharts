/**
 * Minimal cTrader Open API client for serverless environments.
 *
 * cTrader's trading operations use a persistent Protobuf WebSocket connection,
 * so this module only stores OAuth credentials and probes the REST account-info
 * proxy. Trading functions remain stubs until a socket-backed service is added.
 */

export interface CTraderCreds {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  accountId: string;
  baseUrl: string;
}

export interface CTraderAccount {
  ctidTraderAccountId: string;
  balance?: number;
  currency?: string;
  brokerName?: string;
  isLive?: boolean;
}

export interface CTraderPosition {
  positionId: string;
  symbolId: number;
  side: "BUY" | "SELL";
  volume: number;
  entryPrice: number;
  unrealizedPL?: number;
}

export interface CTraderPlaceOrderArgs {
  symbolId: number;
  side: "BUY" | "SELL";
  volume: number;
  orderType: "MARKET" | "LIMIT" | "STOP";
  limitPrice?: number;
  stopPrice?: number;
}

const DEFAULT_BASE_URL = "https://api.ctrader.com";

/** Resolve shared server-side cTrader credentials from environment variables. */
export function ctraderCreds(): CTraderCreds | null {
  const clientId = process.env.CTRADER_CLIENT_ID;
  const clientSecret = process.env.CTRADER_CLIENT_SECRET;
  const accessToken = process.env.CTRADER_ACCESS_TOKEN;
  const accountId = process.env.CTRADER_ACCOUNT_ID;

  if (!clientId || !clientSecret || !accessToken || !accountId) return null;

  return {
    clientId,
    clientSecret,
    accessToken,
    accountId,
    baseUrl: DEFAULT_BASE_URL,
  };
}

/**
 * Resolve a user's stored cTrader credentials, falling back to environment
 * credentials. Stored apiSecret values use the `clientId:clientSecret` format.
 */
export async function ctraderUserCreds(uid: string | null): Promise<CTraderCreds | null> {
  if (uid) {
    const { storeList } = await import("@/lib/store");
    const accounts = await storeList<{
      platform: string;
      ownerUid?: string;
      apiKey?: string;
      apiSecret?: string;
      accountId?: string;
    }>("users.json");
    const mine = accounts.find(
      (account) =>
        account.platform === "ctrader" &&
        account.ownerUid === uid &&
        account.apiKey &&
        account.apiSecret &&
        account.accountId,
    );

    if (mine?.apiKey && mine.apiSecret && mine.accountId) {
      const separatorIndex = mine.apiSecret.indexOf(":");
      if (separatorIndex > 0 && separatorIndex < mine.apiSecret.length - 1) {
        return {
          clientId: mine.apiSecret.slice(0, separatorIndex),
          clientSecret: mine.apiSecret.slice(separatorIndex + 1),
          accessToken: mine.apiKey,
          accountId: mine.accountId,
          baseUrl: DEFAULT_BASE_URL,
        };
      }
    }
  }

  return ctraderCreds();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Validate an OAuth token and account by querying cTrader's account-info proxy. */
export async function ctraderAccountInfo(creds: CTraderCreds): Promise<CTraderAccount> {
  const baseUrl = creds.baseUrl.replace(/\/$/, "");
  const accountId = encodeURIComponent(creds.accountId);
  const response = await fetch(`${baseUrl}/v2/webserv/v1/accountinfo/${accountId}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${creds.accessToken}`,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `cTrader account probe failed: ${response.status}${detail ? ` ${detail}` : ""}`,
    );
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error("cTrader account probe returned an invalid response.");

  const candidate = isRecord(payload.account) ? payload.account : payload;
  const returnedAccountId =
    optionalString(candidate.ctidTraderAccountId) ??
    (typeof candidate.ctidTraderAccountId === "number"
      ? String(candidate.ctidTraderAccountId)
      : creds.accountId);

  return {
    ctidTraderAccountId: returnedAccountId,
    balance: optionalNumber(candidate.balance),
    currency: optionalString(candidate.currency),
    brokerName: optionalString(candidate.brokerName),
    isLive: optionalBoolean(candidate.isLive),
  };
}

/**
 * Position retrieval requires cTrader's persistent Protobuf WebSocket API.
 * Returns no positions until a socket-backed implementation is available.
 */
export async function ctraderPositions(creds: CTraderCreds): Promise<CTraderPosition[]> {
  void creds;
  console.warn(
    "cTrader position retrieval requires a Protobuf WebSocket connection; returning no positions.",
  );
  return [];
}

/** Place an order (not available without cTrader's Protobuf WebSocket API). */
export async function ctraderPlaceOrder(
  creds: CTraderCreds,
  args: CTraderPlaceOrderArgs,
): Promise<{ orderId?: string }> {
  void creds;
  void args;
  throw new Error(
    "cTrader order placement requires WebSocket connection — use the cTrader desktop/web terminal for now",
  );
}

/** Close a position (not available without cTrader's Protobuf WebSocket API). */
export async function ctraderClosePosition(
  creds: CTraderCreds,
  positionId: string,
  volume?: number,
): Promise<void> {
  void creds;
  void positionId;
  void volume;
  throw new Error(
    "cTrader position closing requires WebSocket connection — use the cTrader desktop/web terminal for now",
  );
}
