import { NextRequest, NextResponse } from "next/server";
import { alpaca, userAlpacaCreds } from "@/lib/alpaca";
import { PLATFORMS, platformConfigured } from "@/lib/platforms/registry";
import { projectxAccounts, projectxLogin, userCredsFor } from "@/lib/platforms/projectx";
import { forexClientAccount, forexClientMargin, forexSession, forexUserCreds } from "@/lib/platforms/forex";
import { verifyUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export interface PlatformStatus {
  id: string;
  name: string;
  kind: string;
  configured: boolean;
  connected: boolean;
  /** e.g. balance/equity for the primary account, when reachable. */
  account?: { label: string; balance?: number; currency?: string };
  note?: string;
  envVars: string[];
  capabilities: string[];
}

async function statusOf(id: string, uid: string | null): Promise<Partial<PlatformStatus>> {
  switch (id) {
    case "alpaca": {
      const keys = await userAlpacaCreds(uid);
      if (!keys) return { configured: false };
      const acc = await alpaca<{ equity: string; buying_power: string }>(
        "/v2/account",
        undefined,
        keys,
      );
      return {
        configured: true,
        connected: true,
        account: { label: "Paper account", balance: Number(acc.equity), currency: "USD" },
      };
    }
    case "topstep":
    case "apex": {
      const resolved = await userCredsFor(id, uid);
      if (!resolved) return { configured: false };
      const token = await projectxLogin(resolved.creds);
      const accounts = await projectxAccounts(resolved.creds, token);
      const primary =
        accounts.find((a) => a.id === resolved.accountId) ?? accounts[0];
      return {
        configured: true,
        connected: true,
        account: primary
          ? { label: primary.name, balance: primary.balance, currency: "USD" }
          : { label: "No active accounts" },
      };
    }
    case "forex": {
      const creds = await forexUserCreds(uid);
      if (!creds) return { configured: false };
      const session = await forexSession(creds);
      const client = await forexClientAccount(creds, session);
      let balance: number | undefined;
      let currency = "USD";
      try {
        const margin = await forexClientMargin(creds, session, client.ClientAccountId);
        balance = margin.NetEquity ?? margin.Cash;
        currency = margin.CurrencyISOCode ?? currency;
      } catch {
        // Margin snapshot is informational — account list still proves connectivity.
      }
      const primary = client.TradingAccounts?.[0];
      return {
        configured: true,
        connected: true,
        account: {
          label: primary
            ? `${primary.TradingAccountId} (${primary.TradingAccountStatus ?? "active"})`
            : (client.LogonUserName ?? "FOREX.com"),
          balance,
          currency,
        },
      };
    }
    case "oanda": {
      const { oandaUserCreds, oandaAccountSummary } = await import("@/lib/platforms/oanda");
      const creds = await oandaUserCreds(uid);
      if (!creds) return { configured: false };
      const summary = await oandaAccountSummary(creds);
      return {
        configured: true,
        connected: true,
        account: {
          label: summary.account.alias ?? creds.accountId,
          balance: Number(summary.account.NAV),
          currency: summary.account.currency,
        },
      };
    }
    case "dxtrade": {
      const { dxtradeUserCreds, dxtradeLogin, dxtradeAccounts } = await import("@/lib/platforms/dxtrade");
      const creds = await dxtradeUserCreds(uid);
      if (!creds) return { configured: false };
      const session = await dxtradeLogin(creds);
      const accounts = await dxtradeAccounts(creds, session);
      const primary = accounts[0];
      return {
        configured: true,
        connected: true,
        account: primary
          ? { label: primary.accountCode, currency: primary.currency ?? "USD" }
          : { label: "DXTrade connected" },
      };
    }
    case "ctrader": {
      const { ctraderUserCreds, ctraderAccountInfo } = await import("@/lib/platforms/ctrader");
      const creds = await ctraderUserCreds(uid);
      if (!creds) return { configured: false };
      const info = await ctraderAccountInfo(creds);
      return {
        configured: true,
        connected: true,
        account: {
          label: info.brokerName ?? `cTrader ${info.ctidTraderAccountId}`,
          balance: info.balance,
          currency: info.currency ?? "USD",
        },
      };
    }
    case "ftmo": {
      const { ftmoUserCreds, ftmoProbe } = await import("@/lib/platforms/ftmo");
      const creds = await ftmoUserCreds(uid);
      if (!creds) return { configured: false };
      const probe = await ftmoProbe(creds);
      return {
        configured: true,
        connected: probe.connected,
        account: probe.balance != null
          ? { label: `FTMO (${creds.backend})`, balance: probe.balance, currency: "USD" }
          : undefined,
        note: probe.note,
      };
    }
    case "matchtrade": {
      const { matchtradeUserCreds, matchtradeLogin, matchtradeBalance } = await import("@/lib/platforms/matchtrade");
      const creds = await matchtradeUserCreds(uid);
      if (!creds) return { configured: false };
      const session = await matchtradeLogin(creds);
      const balance = await matchtradeBalance(creds, session);
      return {
        configured: true,
        connected: true,
        account: {
          label: balance.email ?? "Match-Trader",
          balance: balance.equity ?? balance.balance,
          currency: balance.currency ?? "USD",
        },
      };
    }
    case "schwab":
      return { connected: false, note: "OAuth2 adapter not implemented yet" };
    case "ninjatrader":
      return { connected: false, note: "Requires a local NT8 bridge — no cloud API" };
    default:
      return { connected: false };
  }
}

/** Status + connectivity probe for every registered platform. */
export async function GET(req: NextRequest) {
  const uid = await verifyUser(req);
  const statuses = await Promise.all(
    PLATFORMS.map(async (p): Promise<PlatformStatus> => {
      const base: PlatformStatus = {
        id: p.id,
        name: p.name,
        kind: p.kind,
        configured: platformConfigured(p.id),
        connected: false,
        envVars: p.envVars,
        capabilities: p.capabilities,
      };
      try {
        const probe = await statusOf(p.id, uid);
        const configured = base.configured || probe.configured === true;
        if (!configured) return { ...base, note: "Not configured" };
        return { ...base, ...probe, configured };
      } catch (err) {
        return {
          ...base,
          note: `Connection failed: ${err instanceof Error ? err.message : "unknown error"}`,
        };
      }
    }),
  );
  return NextResponse.json({ data: { platforms: statuses } });
}
