import { NextResponse } from "next/server";
import { alpaca } from "@/lib/alpaca";
import { PLATFORMS, platformConfigured } from "@/lib/platforms/registry";
import { apexCreds, projectxAccounts, projectxLogin, topstepCreds } from "@/lib/platforms/projectx";

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

async function statusOf(id: string): Promise<Partial<PlatformStatus>> {
  switch (id) {
    case "alpaca": {
      const acc = await alpaca<{ equity: string; buying_power: string }>("/v2/account");
      return {
        connected: true,
        account: { label: "Paper account", balance: Number(acc.equity), currency: "USD" },
      };
    }
    case "topstep": {
      const creds = topstepCreds();
      if (!creds) return { connected: false };
      const token = await projectxLogin(creds);
      const accounts = await projectxAccounts(creds, token);
      const primary = accounts[0];
      return {
        connected: true,
        account: primary
          ? { label: primary.name, balance: primary.balance, currency: "USD" }
          : { label: "No active accounts" },
      };
    }
    case "apex": {
      const creds = apexCreds();
      if (!creds) return { connected: false };
      const token = await projectxLogin(creds);
      const accounts = await projectxAccounts(creds, token);
      const primary = accounts[0];
      return {
        connected: true,
        account: primary
          ? { label: primary.name, balance: primary.balance, currency: "USD" }
          : { label: "No active accounts" },
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
export async function GET() {
  const statuses = await Promise.all(
    PLATFORMS.map(async (p): Promise<PlatformStatus> => {
      const configured = platformConfigured(p.id);
      const base: PlatformStatus = {
        id: p.id,
        name: p.name,
        kind: p.kind,
        configured,
        connected: false,
        envVars: p.envVars,
        capabilities: p.capabilities,
      };
      if (!configured) return { ...base, note: "Not configured" };
      try {
        return { ...base, ...(await statusOf(p.id)) };
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
