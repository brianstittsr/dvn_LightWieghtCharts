"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicAccount } from "@/lib/settings";

const PLATFORMS = ["alpaca", "topstep", "apex", "schwab", "ninjatrader"] as const;

const EMPTY_FORM = {
  name: "",
  ownerEmail: "",
  platform: "alpaca",
  accountId: "",
  apiKey: "",
  apiSecret: "",
  notes: "",
};

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt?: string;
  lastSignIn?: string;
}

export default function UsersTab() {
  const [users, setUsers] = useState<PublicAccount[]>([]);
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => setUsers(d.data?.users ?? []))
      .catch(() => setErr("Failed to load accounts"))
      .finally(() => setLoading(false));
    fetch("/api/admin/auth-users")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAuthUsers(d?.data?.users ?? []))
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          ownerEmail: form.ownerEmail || undefined,
          platform: form.platform,
          accountId: form.accountId ? Number(form.accountId) : undefined,
          apiKey: form.apiKey || undefined,
          apiSecret: form.apiSecret || undefined,
          notes: form.notes || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(d.error ?? "Failed to add account");
      setForm(EMPTY_FORM);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete account "${name}"?`)) return;
    await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    refresh();
  };

  const input =
    "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-2.5 py-1.5 text-sm outline-none focus:border-[#2962ff]";

  return (
    <div className="space-y-6">
      <form
        onSubmit={add}
        className="rounded-lg border border-[#2a2e39] bg-[#131722] p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-white">Add trading account</h2>
        <div className="grid grid-cols-2 gap-3">
          <input
            aria-label="Account name"
            placeholder="Display name (e.g. TopStep Eval)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={input}
            required
          />
          <input
            aria-label="Owner email (Firebase user)"
            placeholder="Owner email (Firebase user)"
            list="auth-user-emails"
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            className={input}
          />
          <datalist id="auth-user-emails">
            {authUsers.map((u) =>
              u.email ? <option key={u.uid} value={u.email} /> : null,
            )}
          </datalist>
          <input
            aria-label="Platform account ID"
            type="number"
            min={1}
            placeholder={
              ["topstep", "apex"].includes(form.platform)
                ? "ProjectX account ID (pins which account trades)"
                : "Account ID (optional)"
            }
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            className={input}
          />
          <select
            aria-label="Platform"
            value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}
            className={input}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p === "apex" ? "Apex Trader" : p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <input
            aria-label="API key or username"
            placeholder={
              ["topstep", "apex"].includes(form.platform)
                ? "Platform username (not email)"
                : "API key / username (optional)"
            }
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            className={input}
          />
          <input
            aria-label="API secret"
            type="password"
            placeholder={
              ["topstep", "apex"].includes(form.platform)
                ? "ProjectX API key (Settings > API)"
                : "API secret (optional)"
            }
            value={form.apiSecret}
            onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
            className={input}
          />
          <input
            aria-label="Notes"
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className={`${input} col-span-2`}
          />
        </div>
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-3 rounded bg-[#2962ff] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add account
        </button>
      </form>

      <div className="rounded-lg border border-[#2a2e39] bg-[#131722]">
        <h2 className="border-b border-[#2a2e39] px-4 py-3 text-sm font-semibold text-white">
          Accounts ({users.length})
        </h2>
        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">Loading…</p>
        ) : users.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            No accounts yet — add one above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2e39] text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Platform</th>
                <th className="px-4 py-2 font-medium">Acct ID</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Notes</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#1e222d] last:border-0">
                  <td className="px-4 py-2.5 text-white">{u.name}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {u.ownerEmail ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 capitalize text-gray-400">{u.platform}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                    {u.accountId ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                    {u.apiKeyMasked ?? "—"}
                    {u.hasSecret && " + secret"}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-2.5 text-xs text-gray-500">
                    {u.notes ?? ""}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => remove(u.id, u.name)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="rounded-lg border border-[#2a2e39] bg-[#131722]">
        <h2 className="border-b border-[#2a2e39] px-4 py-3 text-sm font-semibold text-white">
          Firebase users ({authUsers.length})
        </h2>
        {authUsers.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            No Firebase users — accounts are created from the login screen&apos;s
            sign-up option.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2e39] text-left text-xs text-gray-500">
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">UID</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {authUsers.map((u) => (
                <tr key={u.uid} className="border-b border-[#1e222d] last:border-0">
                  <td className="px-4 py-2.5 text-white">{u.email ?? "—"}</td>
                  <td className="max-w-[140px] truncate px-4 py-2.5 font-mono text-xs text-gray-500">
                    {u.uid}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {u.lastSignIn ? new Date(u.lastSignIn).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-600">
        Account credentials stored in <code>data/users.json</code> (gitignored) —
        secrets are masked in this list and never sent back to the browser.
        Owners are resolved from Firebase Auth users by email.
      </p>
    </div>
  );
}
