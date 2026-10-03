"use client";

import { signOut } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChartPane } from "@/components/chart-pane";
import { PositionsBar } from "@/components/positions-bar";
import { MarketStatus } from "@/components/market-status";
import { PnlCalendar } from "@/components/pnl-calendar";
import { EconomicCalendar } from "@/components/economic-calendar";
import { BotsDialog } from "@/components/bots-dialog";
import { FuturesTicket } from "@/components/futures-ticket";
import { GuidePanel } from "@/components/guide-panel";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { PlatformsDialog } from "@/components/platforms-dialog";
import { CHART_COUNTS, useChartCount } from "@/hooks/use-chart-count";
import { authFetch } from "@/lib/auth-fetch";
import { featuresFor } from "@/lib/features";
import { firebaseConfigured, getClientAuth } from "@/lib/firebase";
import type { UserProfile } from "@/lib/scanner/types";
import { DEFAULT_PANE_SYMBOLS } from "@/lib/symbols";
import { cn } from "@/lib/utils";

/** Cleanest grid shape per pane count: 1=1×1, 2=2×1, 4=2×2, 6=3×2, 8=4×2. */
const GRID: Record<number, string> = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1",
  4: "grid-cols-1 grid-rows-4 sm:grid-cols-2 sm:grid-rows-2",
  6: "grid-cols-1 grid-rows-6 sm:grid-cols-2 sm:grid-rows-3 lg:grid-cols-3 lg:grid-rows-2",
  8: "grid-cols-1 grid-rows-8 sm:grid-cols-2 sm:grid-rows-4 lg:grid-cols-4 lg:grid-rows-2",
};

export function Dashboard() {
  const [count, setCount] = useChartCount();
  const [calOpen, setCalOpen] = useState(false);
  const [econOpen, setEconOpen] = useState(false);
  const [platOpen, setPlatOpen] = useState(false);
  const [futOpen, setFutOpen] = useState(false);
  const [botsOpen, setBotsOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [wizOpen, setWizOpen] = useState(false);
  // Deep-link from the scanners: /?symbol=AMD loads it into pane 0.
  const urlSymbol = useSearchParams().get("symbol")?.toUpperCase() ?? null;

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) return;
    return auth.onAuthStateChanged((u) => setUserEmail(u?.email ?? null));
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    void authFetch("/api/user-settings")
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!ok) return;
        const p = (d.data?.profile ?? null) as UserProfile | null;
        setProfile(p);
        if (!p?.onboarded) setWizOpen(true);
      })
      .catch(() => {})
      .finally(() => setProfileLoaded(true));
  }, []);

  const features = featuresFor(profile ?? undefined);

  return (
    <div className="flex h-screen flex-col gap-2 bg-neutral-950 p-2">
      <header className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-sm font-semibold text-neutral-200">Live Charts</h1>
        <div className="flex items-center gap-1" role="group" aria-label="Number of charts">
          <span className="mr-1 text-xs text-neutral-500">Number of charts:</span>
          {CHART_COUNTS.map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                count === n
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {features.has("pnl") && (
          <button
            onClick={() => setCalOpen(true)}
            title="P&L calendar"
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
          >
            📅 P&L
          </button>
        )}
        <button
          onClick={() => setEconOpen(true)}
          title="Economic calendar"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          📊 Econ
        </button>
        <button
          onClick={() => setPlatOpen(true)}
          title="Connected trading platforms"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          🔌 Platforms
        </button>
        {features.has("futures") && (
          <button
            onClick={() => setFutOpen(true)}
            title="Futures order ticket (TopStep / Apex)"
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
          >
            ⚡ Futures
          </button>
        )}
        {features.has("bots") && (
          <button
            onClick={() => setBotsOpen(true)}
            title="Trading bots (futures + stocks/crypto)"
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
          >
            🤖 Bots
          </button>
        )}
        {features.has("propFirm") && (
          <Link
            href="/prop-firm"
            title="Prop firm challenge calculator"
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
          >
            🧮 Prop Firm
          </Link>
        )}
        {features.has("scanner") && (
          <Link
            href="/scanner"
            title="Scanners — gappers, setups, alerts"
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
          >
            📡 Scanner
          </Link>
        )}
        <button
          onClick={() => setWizOpen(true)}
          title="Preferences — re-run the setup wizard"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          🧭 Setup
        </button>
        <Link
          href="/admin"
          title="Admin — accounts & settings"
          className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        >
          ⚙ Admin
        </Link>
        {firebaseConfigured && userEmail && (
          <>
            <span className="text-xs text-neutral-500" title="Signed in as">
              {userEmail}
            </span>
            <button
              onClick={() => void signOut(getClientAuth()!)}
              title="Sign out"
              className="rounded bg-red-900/60 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-800/70"
            >
              Sign out
            </button>
          </>
        )}
        <MarketStatus />
      </header>
      <main className={cn("grid min-h-0 flex-1 gap-2", GRID[count])}>
        {Array.from({ length: count }, (_, i) => (
          <ChartPane
            key={i === 0 && urlSymbol ? `pane-0-${urlSymbol}` : `pane-${i}`}
            paneId={`pane-${i}`}
            defaultSymbol={
              i === 0 && urlSymbol
                ? urlSymbol
                : DEFAULT_PANE_SYMBOLS[i % DEFAULT_PANE_SYMBOLS.length]
            }
          />
        ))}
      </main>
      <PositionsBar />
      <PnlCalendar open={calOpen} onClose={() => setCalOpen(false)} />
      <EconomicCalendar open={econOpen} onClose={() => setEconOpen(false)} />
      <PlatformsDialog open={platOpen} onClose={() => setPlatOpen(false)} />
      <FuturesTicket open={futOpen} onClose={() => setFutOpen(false)} />
      <BotsDialog open={botsOpen} onClose={() => setBotsOpen(false)} />
      {profile?.onboarded && (
        <div className="fixed bottom-14 right-3 z-40 w-72">
          <GuidePanel profile={profile} onChange={setProfile} />
        </div>
      )}
      {profileLoaded && wizOpen && firebaseConfigured && (
        <OnboardingWizard
          userEmail={userEmail}
          onDone={(p) => {
            setProfile(p);
            setWizOpen(false);
          }}
        />
      )}
    </div>
  );
}
