"use client";

import { useEffect, useMemo, useState } from "react";
import type { PositionSetup } from "@/components/drawing-layer";
import { authFetch } from "@/lib/auth-fetch";
import { toAlpacaSymbol } from "@/lib/alpaca-symbol";
import { symbolInfo } from "@/lib/symbols";
import { cn } from "@/lib/utils";

interface FuturesAccount {
  id: number;
  name: string;
  balance: number;
}

interface FuturesPlatform {
  id: "topstep" | "apex";
  configured: boolean;
  accounts: FuturesAccount[];
  linkedAccountId?: number;
}

interface FuturesContract {
  id: string;
  name: string;
  tickSize: number;
  tickValue: number;
}

interface AlpacaAccount {
  equity?: string;
  cash?: string;
  buying_power?: string;
}

interface PositionOrderDialogProps {
  setup: PositionSetup | null;
  symbol: string;
  lastPrice: number | null;
  onClose: () => void;
}

type OrderType = "market" | "limit";

const INPUT =
  "w-full rounded border border-neutral-700 bg-[#0b0e11] px-2.5 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500";

export function PositionOrderDialog({ setup, symbol, lastPrice, onClose }: PositionOrderDialogProps) {
  const source = symbolInfo(symbol).source;
  const isFutures = source === "futures";
  const isCrypto = source === "hyperliquid";
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [riskPercent, setRiskPercent] = useState("1");
  const [platforms, setPlatforms] = useState<FuturesPlatform[]>([]);
  const [platform, setPlatform] = useState<"topstep" | "apex">("topstep");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [contract, setContract] = useState<FuturesContract | null>(null);
  const [alpacaAccount, setAlpacaAccount] = useState<AlpacaAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!setup) return;
    if (isFutures) {
      authFetch("/api/futures/status")
        .then(async (response) => {
          const body = (await response.json()) as { data?: { platforms?: FuturesPlatform[] }; error?: string };
          if (!response.ok) throw new Error(body.error ?? "Failed to load futures accounts");
          const available = (body.data?.platforms ?? []).filter((item) => item.configured && item.accounts.length);
          setPlatforms(available);
          const selected = available[0];
          if (!selected) throw new Error("No tradeable TopStep or Apex account is connected");
          setPlatform(selected.id);
          setAccountId(selected.linkedAccountId ?? selected.accounts[0].id);
          return authFetch(`/api/futures/contracts?platform=${selected.id}&q=${encodeURIComponent(symbol)}`);
        })
        .then(async (response) => {
          const body = (await response.json()) as { data?: { contracts?: FuturesContract[] }; error?: string };
          if (!response.ok) throw new Error(body.error ?? "Failed to resolve futures contract");
          const contracts = body.data?.contracts ?? [];
          const selected = contracts.find((item) => item.name.toUpperCase().startsWith(symbol.toUpperCase())) ?? contracts[0] ?? null;
          if (!selected) throw new Error(`No active contract found for ${symbol}`);
          setContract(selected);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Account load failed"));
      return;
    }
    fetch("/api/alpaca/account")
      .then(async (response) => {
        const body = (await response.json()) as { data?: AlpacaAccount; error?: string };
        if (!response.ok || !body.data) throw new Error(body.error ?? "Failed to load Alpaca account");
        setAlpacaAccount(body.data);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Account load failed"));
  }, [isFutures, setup, symbol]);

  const activePlatform = platforms.find((item) => item.id === platform);
  const account = activePlatform?.accounts.find((item) => item.id === accountId);
  const balance = isFutures
    ? account?.balance ?? 0
    : Number(alpacaAccount?.equity ?? alpacaAccount?.cash ?? 0);
  const effectiveEntry = orderType === "market" ? lastPrice ?? setup?.entry ?? 0 : setup?.entry ?? 0;
  const stopDistance = setup ? Math.abs(effectiveEntry - setup.stop) : 0;
  const validStop = setup
    ? setup.side === "long"
      ? setup.stop < effectiveEntry
      : setup.stop > effectiveEntry
    : false;
  const target = setup
    ? setup.side === "long"
      ? effectiveEntry + stopDistance * setup.riskReward
      : effectiveEntry - stopDistance * setup.riskReward
    : 0;
  const riskAmount = balance * (Math.max(0, Math.min(100, Number(riskPercent) || 0)) / 100);
  const quantity = useMemo(() => {
    if (!setup || !(riskAmount > 0) || !(stopDistance > 0)) return 0;
    if (isFutures) {
      if (!contract || !(contract.tickSize > 0) || !(contract.tickValue > 0)) return 0;
      const riskPerContract = (stopDistance / contract.tickSize) * contract.tickValue;
      return Math.max(0, Math.min(500, Math.floor(riskAmount / riskPerContract)));
    }
    const raw = riskAmount / stopDistance;
    return isCrypto ? Math.floor(raw * 1_000_000) / 1_000_000 : Math.floor(raw);
  }, [contract, isCrypto, isFutures, riskAmount, setup, stopDistance]);

  if (!setup) return null;

  const changePlatform = (next: "topstep" | "apex") => {
    setPlatform(next);
    const selected = platforms.find((item) => item.id === next);
    setAccountId(selected?.linkedAccountId ?? selected?.accounts[0]?.id ?? null);
    setContract(null);
    authFetch(`/api/futures/contracts?platform=${next}&q=${encodeURIComponent(symbol)}`)
      .then((response) => response.json())
      .then((body) => setContract(body.data?.contracts?.[0] ?? null))
      .catch(() => setError("Failed to resolve futures contract"));
  };

  const submit = async () => {
    if (setup.side === "short" && isCrypto) {
      setError("Alpaca crypto supports long entries only; crypto short orders are unavailable");
      return;
    }
    if (!validStop) {
      setError(`The stop must remain ${setup.side === "long" ? "below" : "above"} the current entry price`);
      return;
    }
    if (!(quantity > 0)) {
      setError("Risk is too small for one unit/contract, or account data is unavailable");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = isFutures
        ? await authFetch("/api/futures/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "place",
              platform,
              accountId,
              contractId: contract?.id,
              side: setup.side === "long" ? "buy" : "sell",
              size: quantity,
              type: orderType,
              limitPrice: orderType === "limit" ? setup.entry : undefined,
              slTicks: contract ? Math.max(1, Math.round(Math.abs(effectiveEntry - setup.stop) / contract.tickSize)) : undefined,
              tpTicks: contract ? Math.max(1, Math.round(Math.abs(target - effectiveEntry) / contract.tickSize)) : undefined,
            }),
          })
        : await fetch("/api/alpaca/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: toAlpacaSymbol(symbol),
              qty: quantity,
              side: setup.side === "long" ? "buy" : "sell",
              type: orderType,
              limit_price: orderType === "limit" ? setup.entry : undefined,
              ...(isCrypto ? {} : { take_profit: target, stop_loss: setup.stop }),
            }),
          });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Order submission failed");
      window.dispatchEvent(new Event("alpaca-orders-changed"));
      setMessage(`${setup.side.toUpperCase()} ${quantity} ${symbol} submitted`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Order submission failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border border-neutral-700 bg-[#131722] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">{setup.side === "long" ? "Long" : "Short"} {symbol}</h2>
            <p className="text-[10px] text-neutral-500">Risk-sized position · target {setup.riskReward}:1</p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white" aria-label="Close">×</button>
        </div>

        {isFutures && platforms.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="text-[10px] text-neutral-400">Platform
              <select value={platform} onChange={(event) => changePlatform(event.target.value as "topstep" | "apex")} className={cn(INPUT, "mt-1")}>
                {platforms.map((item) => <option key={item.id} value={item.id}>{item.id === "topstep" ? "TopStep" : "Apex"}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-neutral-400">Account
              <select value={accountId ?? ""} onChange={(event) => setAccountId(Number(event.target.value))} className={cn(INPUT, "mt-1")}>
                {(activePlatform?.accounts ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="text-[10px] text-neutral-400">Order type
            <select value={orderType} onChange={(event) => setOrderType(event.target.value as OrderType)} className={cn(INPUT, "mt-1")}>
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </label>
          <label className="text-[10px] text-neutral-400">Risk % of balance
            <input type="number" min="0.01" max="100" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(event.target.value)} className={cn(INPUT, "mt-1")} />
          </label>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-black/25 p-3 font-mono text-[11px] text-neutral-300">
          <span>Balance</span><span className="text-right">${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span>Risk amount</span><span className="text-right">${riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span>Entry</span><span className="text-right">{effectiveEntry.toLocaleString()}</span>
          <span>Stop</span><span className="text-right text-red-400">{setup.stop.toLocaleString()}</span>
          <span>Target</span><span className="text-right text-emerald-400">{target.toLocaleString()}</span>
          <span>{isFutures ? "Contracts" : "Quantity"}</span><span className="text-right font-semibold text-white">{quantity}</span>
        </div>

        {isCrypto && (
          <p className="mb-3 rounded border border-amber-800/50 bg-amber-950/30 p-2 text-[10px] text-amber-300">
            Alpaca crypto is long-only here and does not support attached bracket exits. The chart keeps the visual target and stop, but only the entry order is submitted.
          </p>
        )}
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        {message && <p className="mb-3 text-xs text-emerald-400">{message}</p>}
        <button
          onClick={submit}
          disabled={busy || !validStop || (setup.side === "short" && isCrypto) || quantity <= 0}
          className={cn(
            "w-full rounded py-2.5 text-sm font-semibold text-white disabled:opacity-40",
            setup.side === "long" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500",
          )}
        >
          {busy ? "Submitting…" : `${setup.side === "long" ? "Buy" : "Sell"} ${quantity || "—"} ${symbol} · ${orderType.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}
