/**
 * FTMO integration — FTMO is a prop firm that does NOT expose a proprietary API.
 *
 * FTMO accounts run on one of three backends:
 *   - cTrader (FTMO cTrader accounts — use the cTrader Open API)
 *   - DXTrade (FTMO DXTrade accounts — REST API access was revoked Apr 2024)
 *   - MetaTrader 4/5 (requires local bridge or MetaAPI.cloud)
 *
 * This module stores FTMO credentials and routes to the correct underlying
 * platform client. The recommended path for algo trading is cTrader.
 *
 * Credential mapping:
 *   apiKey    = platform login / cTrader access token
 *   apiSecret = password / cTrader clientId:clientSecret
 *   appKey    = backend identifier ("ctrader" | "dxtrade" | "mt4" | "mt5")
 *   accountId = trading account number
 */

export type FtmoBackend = "ctrader" | "dxtrade" | "mt4" | "mt5";

export interface FtmoCreds {
  backend: FtmoBackend;
  login: string;
  secret: string;
  accountId?: string;
}

/** Env-var fallback. */
export function ftmoCreds(): FtmoCreds | null {
  const backend = (process.env.FTMO_BACKEND ?? "ctrader") as FtmoBackend;
  const login = process.env.FTMO_LOGIN;
  const secret = process.env.FTMO_SECRET;
  if (!login || !secret) return null;
  return {
    backend,
    login,
    secret,
    accountId: process.env.FTMO_ACCOUNT_ID,
  };
}

/** Per-user creds from store. */
export async function ftmoUserCreds(uid: string | null): Promise<FtmoCreds | null> {
  if (uid) {
    const { storeList } = await import("@/lib/store");
    const accounts = await storeList<{
      platform: string;
      ownerUid?: string;
      apiKey?: string;
      apiSecret?: string;
      appKey?: string;
      accountId?: number;
    }>("users.json");
    const mine = accounts.find(
      (a) =>
        a.platform === "ftmo" &&
        a.ownerUid === uid &&
        a.apiKey &&
        a.apiSecret,
    );
    if (mine?.apiKey && mine.apiSecret) {
      return {
        backend: (mine.appKey ?? "ctrader") as FtmoBackend,
        login: mine.apiKey,
        secret: mine.apiSecret,
        accountId: mine.accountId ? String(mine.accountId) : undefined,
      };
    }
  }
  return ftmoCreds();
}

/**
 * Probe connectivity by delegating to the underlying platform.
 * Returns account info when available, or a descriptive status note.
 */
export async function ftmoProbe(
  creds: FtmoCreds,
): Promise<{ connected: boolean; note?: string; balance?: number }> {
  switch (creds.backend) {
    case "ctrader": {
      try {
        const { ctraderAccountInfo } = await import("@/lib/platforms/ctrader");
        const info = await ctraderAccountInfo({
          clientId: creds.secret.split(":")[0] ?? "",
          clientSecret: creds.secret.split(":")[1] ?? "",
          accessToken: creds.login,
          accountId: creds.accountId ?? "",
          baseUrl: "https://api.ctrader.com",
        });
        return {
          connected: true,
          balance: info.balance,
          note: info.brokerName ? `via ${info.brokerName}` : undefined,
        };
      } catch (e) {
        return {
          connected: false,
          note: `cTrader probe failed: ${e instanceof Error ? e.message : "unknown"}`,
        };
      }
    }
    case "dxtrade":
      return {
        connected: false,
        note: "FTMO revoked DXTrade REST API access (Apr 2024). Use cTrader or MetaTrader.",
      };
    case "mt4":
    case "mt5":
      return {
        connected: false,
        note: `FTMO ${creds.backend.toUpperCase()} accounts require MetaAPI.cloud or a local EA bridge — not yet supported.`,
      };
    default:
      return { connected: false, note: "Unknown FTMO backend" };
  }
}
