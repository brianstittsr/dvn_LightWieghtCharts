"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TickerBarProps {
  label: string;
  price: number | null;
  dayOpen: number | null;
}

/** Colour-coded price strip; flashes green/red on every price change. */
export function TickerBar({ label, price, dayOpen }: TickerBarProps) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    if (price == null) return;
    const prev = prevRef.current;
    prevRef.current = price;
    if (prev == null || price === prev) return;
    setFlash(price > prev ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 450);
    return () => clearTimeout(t);
  }, [price]);

  const changePct =
    price != null && dayOpen != null && dayOpen !== 0
      ? ((price - dayOpen) / dayOpen) * 100
      : null;

  return (
    <div
      className={cn(
        "flex items-baseline gap-3 rounded px-2 py-1 font-mono transition-colors duration-300",
        flash === "up" && "bg-green-500/25 text-green-300",
        flash === "down" && "bg-red-500/25 text-red-300",
        flash == null && "text-neutral-200",
      )}
    >
      <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      <span className="text-sm font-semibold">
        {price != null ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
      </span>
      <span
        className={cn(
          "text-xs",
          changePct != null && changePct >= 0 ? "text-green-400" : "text-red-400",
        )}
      >
        {changePct != null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : ""}
      </span>
    </div>
  );
}
