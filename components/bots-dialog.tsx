"use client";

import { useState } from "react";
import { AlpacaBots } from "@/components/alpaca-bots";
import { FuturesBots } from "@/components/futures-bots";
import { cn } from "@/lib/utils";

type Venue = "futures" | "alpaca";

/** One bots dialog — tabs switch between the futures and Alpaca engines. */
export function BotsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [venue, setVenue] = useState<Venue>("futures");
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1 border-b border-[#2a2e39] px-3 py-2">
          {(
            [
              ["futures", "⚡ Futures bots"],
              ["alpaca", "📈 Stock & crypto bots"],
            ] as [Venue, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setVenue(id)}
              className={cn(
                "rounded px-3 py-1 text-xs font-semibold transition-colors",
                venue === id
                  ? "bg-[#2962ff] text-white"
                  : "bg-neutral-800 text-gray-400 hover:bg-neutral-700",
              )}
            >
              {label}
            </button>
          ))}
          <button
            onClick={onClose}
            className="ml-auto text-gray-500 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {venue === "futures" ? (
            <FuturesBots open embedded onClose={onClose} />
          ) : (
            <AlpacaBots />
          )}
        </div>
      </div>
    </div>
  );
}
