"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import UsersTab from "./users-tab";
import SettingsTab from "./settings-tab";

type AuthState = "loading" | "login" | "authed";

export default function AdminPanel() {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [notConfigured, setNotConfigured] = useState(false);
  const [tab, setTab] = useState<"users" | "settings">("users");

  const check = useCallback(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((d) => {
        setNotConfigured(!d.data?.configured);
        setAuth(d.data?.authed ? "authed" : "login");
      })
      .catch(() => setAuth("login"));
  }, []);

  useEffect(check, [check]);

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuth("login");
  };

  return (
    <div className="min-h-screen bg-[#0b0e11] text-gray-200">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Admin</h1>
            <p className="text-xs text-gray-500">
              Manage trading accounts and app settings
            </p>
          </div>
          <div className="flex items-center gap-3">
            {auth === "authed" && (
              <button
                onClick={logout}
                className="rounded border border-[#2a2e39] px-3 py-1 text-xs text-gray-400 hover:text-white"
              >
                Sign out
              </button>
            )}
            <Link
              href="/"
              className="rounded border border-[#2a2e39] px-3 py-1 text-xs text-gray-400 hover:text-white"
            >
              ← Dashboard
            </Link>
          </div>
        </div>

        {notConfigured && (
          <div className="mb-4 rounded border border-amber-700/50 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
            <code>ADMIN_PASSWORD</code> is not set. Add it to{" "}
            <code>.env.local</code> and restart the dev server to enable admin
            access.
          </div>
        )}

        {auth === "loading" && (
          <div className="py-20 text-center text-sm text-gray-500">Loading…</div>
        )}

        {auth === "login" && <LoginForm onSuccess={() => setAuth("authed")} />}

        {auth === "authed" && (
          <>
            <div className="mb-4 flex gap-1 border-b border-[#2a2e39]">
              {(["users", "settings"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm capitalize ${
                    tab === t
                      ? "border-b-2 border-[#2962ff] text-white"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {t === "users" ? "Trading accounts" : "App settings"}
                </button>
              ))}
            </div>
            {tab === "users" ? <UsersTab /> : <SettingsTab />}
          </>
        )}
      </div>
    </div>
  );
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) return onSuccess();
      const d = await res.json().catch(() => ({}));
      setErr(d.error ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-16 w-full max-w-xs rounded-lg border border-[#2a2e39] bg-[#131722] p-6"
    >
      <label className="mb-2 block text-xs text-gray-400" htmlFor="admin-pw">
        Admin password
      </label>
      <input
        id="admin-pw"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoFocus
        className="mb-3 w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-3 py-2 text-sm outline-none focus:border-[#2962ff]"
      />
      {err && <p className="mb-3 text-xs text-red-400">{err}</p>}
      <button
        type="submit"
        disabled={busy || !pw}
        className="w-full rounded bg-[#2962ff] py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
