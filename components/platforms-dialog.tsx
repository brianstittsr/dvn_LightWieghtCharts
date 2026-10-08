"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { usd } from "@/lib/utils";
import type { PlatformStatus } from "@/app/api/platforms/route";
import { PLATFORMS, type PlatformDef } from "@/lib/platforms/registry";
import type { PublicAccount } from "@/lib/settings";

const KIND_LABEL: Record<PlatformDef["kind"], string> = {
  broker: "Broker",
  prop: "Prop firm",
  desktop: "Desktop",
};

/** Which fields each platform's self-serve credential form needs. */
const CRED_FIELDS: Record<
  string,
  { apiKey: string; apiSecret: string; appKey?: string; accountId?: string }
> = {
  alpaca: { apiKey: "Key ID", apiSecret: "Secret key" },
  topstep: {
    apiKey: "Platform username",
    apiSecret: "ProjectX API key",
    accountId: "Account ID",
  },
  apex: {
    apiKey: "Platform username",
    apiSecret: "ProjectX API key",
    accountId: "Account ID",
  },
  forex: { apiKey: "Username", apiSecret: "Password", appKey: "AppKey" },
};

const INPUT =
  "w-full rounded border border-neutral-700 bg-[#0b0e11] px-2 py-1 text-xs text-neutral-200 outline-none focus:border-[#2962ff]";

/** Self-serve credential form for one platform (saved to the caller's account). */
function AccountCreds({
  platform,
  account,
  onChanged,
}: {
  platform: string;
  account?: PublicAccount;
  onChanged: () => void;
}) {
  const labels = CRED_FIELDS[platform];
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [appKey, setAppKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!labels) return null;

  const save = async () => {
    setBusy(true);
    setErr("");
    const res = await authFetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        apiKey: apiKey || undefined,
        apiSecret: apiSecret || undefined,
        appKey: appKey || undefined,
        accountId: accountId ? Number(accountId) : undefined,
      }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setErr(d.error ?? "Save failed");
    setApiKey("");
    setApiSecret("");
    setAppKey("");
    setAccountId("");
    setOpen(false);
    onChanged();
  };

  const remove = async () => {
    if (!window.confirm("Remove your saved credentials for this platform?")) return;
    setBusy(true);
    await authFetch(`/api/accounts?platform=${platform}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  };

  return (
    <div className="mt-2 border-t border-neutral-800 pt-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen(!open)}
          className="text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          {open ? "▾ Hide credentials" : "▸ Your API credentials"}
        </button>
        <span className="text-[10px] text-neutral-500">
          {account ? (
            <>
              <span className="font-mono">{account.apiKeyMasked ?? "saved"}</span>
              {account.hasSecret && " +secret"}
              {account.hasAppKey && " +appkey"}
            </>
          ) : (
            "not linked"
          )}
        </span>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          <input
            className={INPUT}
            placeholder={`${labels.apiKey} ${account?.apiKeyMasked ? `(current ${account.apiKeyMasked})` : ""}`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input
            className={INPUT}
            type="password"
            placeholder={`${labels.apiSecret} ${account?.hasSecret ? "(saved — leave blank to keep)" : ""}`}
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
          />
          {labels.appKey && (
            <input
              className={INPUT}
              type="password"
              placeholder={`${labels.appKey} ${account?.hasAppKey ? "(saved — leave blank to keep)" : ""}`}
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
            />
          )}
          {labels.accountId && (
            <input
              className={INPUT}
              type="number"
              min={1}
              placeholder={`${labels.accountId} ${account?.accountId ? `(current ${account.accountId})` : "(optional)"}`}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
          )}
          {err && <p className="text-[10px] text-red-400">{err}</p>}
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={save}
              disabled={busy || (!apiKey && !apiSecret && !appKey && !accountId)}
              className="rounded bg-[#2962ff] px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-40"
            >
              {account ? "Update" : "Save"}
            </button>
            {account && (
              <button
                onClick={remove}
                disabled={busy}
                className="rounded border border-red-900/60 px-2.5 py-1 text-[10px] text-red-400 hover:bg-red-900/20 disabled:opacity-40"
              >
                Remove
              </button>
            )}
            <span className="ml-auto self-center text-[9px] text-neutral-600">
              stored in Firestore · blank fields keep existing values
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  p,
  status,
  account,
  onChanged,
}: {
  p: PlatformDef;
  status: PlatformStatus | undefined;
  account?: PublicAccount;
  onChanged: () => void;
}) {
  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;
  const dot = connected ? "bg-green-400" : configured ? "bg-amber-400" : "bg-neutral-600";
  const stateLabel = connected ? "Connected" : configured ? "Configured" : "Not connected";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-sm font-semibold text-neutral-100">{p.name}</span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
            {KIND_LABEL[p.kind]}
          </span>
        </div>
        <span className={`text-[10px] font-medium ${connected ? "text-green-400" : "text-neutral-500"}`}>
          {stateLabel}
        </span>
      </div>

      {status?.account && (
        <div className="mt-2 font-mono text-xs text-neutral-300">
          {status.account.label}
          {status.account.balance !== undefined && (
            <span className="ml-2 text-green-400">{usd(status.account.balance)}</span>
          )}
        </div>
      )}
      {status?.note && <div className="mt-1.5 text-[10px] text-amber-400/90">{status.note}</div>}

      <div className="mt-2 flex flex-wrap gap-1">
        {p.capabilities.map((c) => (
          <span key={c} className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400">
            {c}
          </span>
        ))}
      </div>

      {CRED_FIELDS[p.id] && (
        <AccountCreds platform={p.id} account={account} onChanged={onChanged} />
      )}

      {!connected && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-neutral-500 hover:text-neutral-300">
            Setup
          </summary>
          <p className="mt-1 text-[10px] leading-snug text-neutral-400">{p.setup}</p>
          {p.envVars.length > 0 && (
            <div className="mt-1 space-y-0.5 font-mono text-[9px] text-neutral-500">
              {p.envVars.map((v) => (
                <div key={v}>{v}</div>
              ))}
            </div>
          )}
        </details>
      )}
    </div>
  );
}

/** Broker/prop-platform connection status + self-serve API credentials. */
export function PlatformsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [statuses, setStatuses] = useState<PlatformStatus[] | null>(null);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    authFetch("/api/platforms")
      .then(async (r) => {
        const b = (await r.json()) as { data?: { platforms: PlatformStatus[] }; error?: string };
        if (!r.ok || !b.data) throw new Error(b.error ?? "Failed to load");
        setStatuses(b.data.platforms);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
    authFetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAccounts(d?.data?.accounts ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-neutral-800 bg-[#0d0f13] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-neutral-100">Trading Platforms</h2>
            <p className="text-[10px] text-neutral-500">
              Connect your API credentials — saved per-user in Firestore, with
              .env.local as the shared fallback
            </p>
          </div>
          <button onClick={onClose} className="text-xl text-neutral-500 hover:text-neutral-200" aria-label="Close">
            ×
          </button>
        </div>

        {error && <div className="mb-3 rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
        {!statuses && !error && (
          <div className="py-12 text-center text-xs text-neutral-500">Probing connections…</div>
        )}

        <div className="space-y-2">
          {PLATFORMS.map((p) => (
            <Card
              key={p.id}
              p={p}
              status={statuses?.find((s) => s.id === p.id)}
              account={accounts.find((a) => a.platform === p.id)}
              onChanged={load}
            />
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-snug text-neutral-600">
          TopStep/Apex: platform username + ProjectX API key. FOREX.com: username +
          password + AppKey from support.en@forex.com. Alpaca: paper Key ID + secret.
          Secrets are masked once saved and never leave the server.
        </p>
      </div>
    </div>
  );
}
