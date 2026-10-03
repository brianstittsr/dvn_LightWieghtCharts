"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getClientAuth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

/** fetch() that attaches the current Firebase ID token, when signed in. */
async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = getClientAuth();
  const token = await auth?.currentUser?.getIdToken();
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

interface FutAccount {
  id: number;
  name: string;
  balance: number;
}
interface FutPlatform {
  id: string;
  configured: boolean;
  accounts: FutAccount[];
  linkedAccountId?: number;
  error?: string;
}
interface FutContract {
  id: string;
  name: string;
  description: string;
  symbolId: string;
  tickSize: number;
  tickValue: number;
}
interface FutPosition {
  id: number;
  contractId: string;
  side: "long" | "short";
  size: number;
  averagePrice: number;
}

const QTY_PRESETS = [1, 3, 5, 10, 15];
const TYPE_LABEL: Record<string, string> = {
  market: "MARKET",
  limit: "LIMIT",
  joinBid: "JOIN BID",
  joinAsk: "JOIN ASK",
};

export function FuturesTicket({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [platforms, setPlatforms] = useState<FutPlatform[]>([]);
  const [platform, setPlatform] = useState("");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [contracts, setContracts] = useState<FutContract[]>([]);
  const [contractId, setContractId] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [qty, setQty] = useState(3);
  const [bracket, setBracket] = useState(false);
  const [tpTicks, setTpTicks] = useState("20");
  const [slTicks, setSlTicks] = useState("10");
  const [showBracketCfg, setShowBracketCfg] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [positions, setPositions] = useState<FutPosition[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [searchQ, setSearchQ] = useState("ES");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const plat = platforms.find((p) => p.id === platform);
  const contract = contracts.find((c) => c.id === contractId);
  const position = positions.find((p) => p.contractId === contractId) ?? null;

  // Load configured platforms + accounts when opened.
  useEffect(() => {
    if (!open) return;
    authFetch("/api/futures/status")
      .then((r) => r.json())
      .then((d) => {
        const list: FutPlatform[] = d.data?.platforms ?? [];
        setPlatforms(list);
        const first = list.find((p) => p.accounts.length > 0);
        if (first) {
          setPlatform(first.id);
          setAccountId(first.linkedAccountId ?? first.accounts[0].id);
        }
      })
      .catch(() => setErr("Failed to load futures platforms"));
  }, [open]);

  // Contract search (debounced via effect on platform+query).
  useEffect(() => {
    if (!open || !platform) return;
    const t = setTimeout(() => {
      authFetch(`/api/futures/contracts?platform=${platform}&q=${encodeURIComponent(searchQ)}`)
        .then((r) => r.json())
        .then((d) => {
          const list: FutContract[] = d.data?.contracts ?? [];
          setContracts(list);
          if (!list.find((c) => c.id === contractId) && list.length) {
            setContractId(list[0].id);
          }
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [open, platform, searchQ, contractId]);

  // Poll quote + positions while open.
  const refresh = useCallback(() => {
    if (!platform || !accountId || !contractId) return;
    authFetch(`/api/futures/quote?platform=${platform}&contractId=${encodeURIComponent(contractId)}`)
      .then((r) => r.json())
      .then((d) => setLast(d.data?.last ?? null))
      .catch(() => {});
    authFetch(`/api/futures/positions?platform=${platform}&accountId=${accountId}`)
      .then((r) => r.json())
      .then((d) => setPositions(d.data?.positions ?? []))
      .catch(() => {});
  }, [platform, accountId, contractId]);

  useEffect(() => {
    if (!open) return;
    refresh();
    pollRef.current = setInterval(refresh, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, refresh]);

  const send = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setErr("");
    setMsg("");
    try {
      const res = await authFetch("/api/futures/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, accountId, ...body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(d.error ?? `${label} failed`);
      setMsg(
        body.action === "place"
          ? `Order ${d.data?.orderId} submitted`
          : `${label} done`,
      );
      refresh();
    } finally {
      setBusy("");
    }
  };

  const place = (side: "buy" | "sell", type?: "joinBid" | "joinAsk") =>
    send(
      {
        action: "place",
        contractId,
        side,
        size: qty,
        type: type ?? orderType,
        limitPrice: orderType === "limit" ? Number(limitPrice) : undefined,
        tpTicks: bracket ? Number(tpTicks) || undefined : undefined,
        slTicks: bracket ? Number(slTicks) || undefined : undefined,
      },
      `${side.toUpperCase()} ${qty}`,
    );

  if (!open) return null;

  const configured = platforms.filter((p) => p.configured);
  const sel =
    "w-full rounded-md border border-[#2a2e39] bg-[#0b0e11] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#2962ff]";
  const lbl = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500";
  const btn =
    "rounded-md px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40";
  const action = "bg-[#3a3f4b] hover:bg-[#4a505e]";
  const danger = "bg-[#5b2d33] hover:bg-[#6e3941]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[#2a2e39] bg-[#131722] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Futures Ticket</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        {configured.length === 0 ? (
          <p className="rounded border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-300">
            No futures account linked to your login. In <strong>Admin →
            Trading accounts</strong>, add a TopStep/Apex account with your
            email as owner — username in the key field, ProjectX API key in
            the secret field. (Or set <code>TOPSTEP_*</code>/<code>APEX_*</code>
            in <code>.env.local</code> as a shared fallback.)
          </p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className={lbl} htmlFor="fx-plat">Platform</label>
                <select
                  id="fx-plat"
                  value={platform}
                  onChange={(e) => {
                    setPlatform(e.target.value);
                    const p = platforms.find((x) => x.id === e.target.value);
                    setAccountId(p?.linkedAccountId ?? p?.accounts[0]?.id ?? null);
                  }}
                  className={sel}
                >
                  {configured.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === "topstep" ? "TopStep" : "Apex"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl} htmlFor="fx-acct">Account</label>
                <select
                  id="fx-acct"
                  value={accountId ?? ""}
                  onChange={(e) => setAccountId(Number(e.target.value))}
                  className={sel}
                >
                  {(plat?.accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · ${a.balance.toLocaleString()}
                      {a.id === plat?.linkedAccountId ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {plat?.error && (
              <p className="mb-2 text-xs text-red-400">{plat.error}</p>
            )}

            <label className={lbl} htmlFor="fx-contract">Contract</label>
            <div className="mb-3 flex gap-2">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value.toUpperCase())}
                placeholder="Search (ES, NQ…)"
                className={cn(sel, "w-24")}
                aria-label="Contract search"
              />
              <select
                id="fx-contract"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                className={sel}
              >
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className={lbl} htmlFor="fx-type">Order Type</label>
                <select
                  id="fx-type"
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value as "market" | "limit")}
                  className={sel}
                >
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                </select>
              </div>
              <div>
                <label className={lbl} htmlFor="fx-qty"># of Contracts</label>
                <input
                  id="fx-qty"
                  type="number"
                  min={1}
                  max={500}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(500, +e.target.value || 1)))}
                  className={sel}
                />
              </div>
            </div>
            {orderType === "limit" && (
              <div className="mb-3">
                <label className={lbl} htmlFor="fx-limit">Limit price</label>
                <input
                  id="fx-limit"
                  type="number"
                  step={contract?.tickSize ?? 0.25}
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  className={sel}
                />
              </div>
            )}

            {/* Quote strip — ProjectX REST has no bid/ask stream; show last. */}
            <div className="mb-1 flex items-center justify-center gap-3">
              <span className="rounded border border-emerald-800/50 px-3 py-1 text-xs text-emerald-400">
                Bid: —
              </span>
              <span className="text-sm font-bold text-white">
                {last != null ? last.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
              </span>
              <span className="rounded border border-red-800/50 px-3 py-1 text-xs text-red-400">
                Ask: —
              </span>
            </div>
            <p className="mb-3 text-center text-[10px] text-gray-600">
              Last price (1m bar) — live bid/ask need the SignalR feed
            </p>

            <p className="mb-3 text-center text-xs text-gray-400">
              {position ? (
                <>
                  <span className={position.side === "long" ? "text-emerald-400" : "text-red-400"}>
                    {position.side === "long" ? "Long" : "Short"} {position.size}
                  </span>{" "}
                  @ {position.averagePrice.toLocaleString()}
                </>
              ) : (
                "No Active Position"
              )}
            </p>

            {/* Qty presets */}
            <div className="mb-3 flex items-center justify-center gap-1.5">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className={cn(btn, action, "h-8 w-8 rounded-full")}
                aria-label="Decrease quantity"
              >
                −
              </button>
              {QTY_PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => setQty(n)}
                  className={cn(
                    btn,
                    "h-8 w-8 rounded-full",
                    qty === n ? "bg-[#2962ff]" : action,
                  )}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setQty((q) => Math.min(500, q + 1))}
                className={cn(btn, action, "h-8 w-8 rounded-full")}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>

            {/* Bracket */}
            <div className="mb-3 flex items-end gap-2">
              <div className="flex-1">
                <label className={lbl} htmlFor="fx-bracket">Position Bracket</label>
                <select
                  id="fx-bracket"
                  value={bracket ? "on" : "off"}
                  onChange={(e) => setBracket(e.target.value === "on")}
                  className={sel}
                >
                  <option value="off">Disabled</option>
                  <option value="on">Enabled</option>
                </select>
              </div>
              <button
                onClick={() => setShowBracketCfg((v) => !v)}
                className={cn(btn, action, "h-9 w-9")}
                aria-label="Bracket settings"
              >
                ⚙
              </button>
            </div>
            {showBracketCfg && (
              <div className="mb-3 grid grid-cols-2 gap-2 rounded border border-[#2a2e39] p-2">
                <label className="text-[11px] text-gray-400">
                  TP ticks
                  <input
                    type="number"
                    min={1}
                    value={tpTicks}
                    onChange={(e) => setTpTicks(e.target.value)}
                    className={cn(sel, "mt-1")}
                  />
                </label>
                <label className="text-[11px] text-gray-400">
                  SL ticks
                  <input
                    type="number"
                    min={1}
                    value={slTicks}
                    onChange={(e) => setSlTicks(e.target.value)}
                    className={cn(sel, "mt-1")}
                  />
                </label>
              </div>
            )}

            {(msg || err) && (
              <p className={cn("mb-3 text-center text-xs", err ? "text-red-400" : "text-emerald-400")}>
                {err || msg}
              </p>
            )}

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={Boolean(busy) || !contractId}
                onClick={() => place("buy")}
                className={cn(btn, "bg-[#1e7a3c] py-3 hover:bg-[#259a4b]")}
              >
                BUY +{qty} @ {TYPE_LABEL[orderType]}
              </button>
              <button
                disabled={Boolean(busy) || !contractId}
                onClick={() => place("sell")}
                className={cn(btn, "bg-[#a8323c] py-3 hover:bg-[#c43d49]")}
              >
                SELL −{qty} @ {TYPE_LABEL[orderType]}
              </button>
              <button
                disabled={Boolean(busy) || !contractId}
                onClick={() => place("buy", "joinBid")}
                className={cn(btn, action)}
              >
                JOIN BID
              </button>
              <button
                disabled={Boolean(busy) || !contractId}
                onClick={() => place("sell", "joinAsk")}
                className={cn(btn, action)}
              >
                JOIN ASK
              </button>
              <button
                disabled={Boolean(busy) || !position}
                onClick={() => send({ action: "close", contractId }, "Close")}
                className={cn(btn, danger)}
              >
                CLOSE POSITION
              </button>
              <button
                disabled={Boolean(busy) || !position}
                onClick={() => send({ action: "reverse", contractId }, "Reverse")}
                className={cn(btn, danger)}
              >
                REVERSE POSITION
              </button>
              <button
                disabled={Boolean(busy) || !contractId}
                onClick={() => send({ action: "cancelContract", contractId }, "Cancel")}
                className={cn(btn, danger)}
              >
                CANCEL ORDERS
              </button>
              <button
                disabled={Boolean(busy)}
                onClick={() => send({ action: "flattenAll" }, "Flatten")}
                className={cn(btn, danger)}
              >
                FLATTEN ALL
              </button>
              <button
                disabled={Boolean(busy)}
                onClick={() => send({ action: "cancelAll" }, "Cancel all")}
                className={cn(btn, danger, "col-span-2")}
              >
                CANCEL ALL
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
