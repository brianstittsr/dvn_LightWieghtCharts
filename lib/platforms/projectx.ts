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
