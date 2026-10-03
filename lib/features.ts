import type { InterestKey, UserProfile } from "@/lib/scanner/types";

/** UI features that can be gated by onboarding interests. */
export type FeatureKey =
  | "scanner" // premarket + setup scanners, watchlists
  | "bots" // bots dialog (futures + alpaca)
  | "futures" // futures ticket drawer/button
  | "propFirm" // challenge calculator + bot wizard
  | "pnl" // P&L calendar
  | "backtest" // backtest button in chart panes
  | "aiTools"; // AI indicators/strategy generation in chart panes

const INTEREST_FEATURES: Record<InterestKey, FeatureKey[]> = {
  premarket: ["scanner"],
  bots: ["bots", "scanner"],
  "live-trading": ["futures", "pnl", "bots"],
  "technical-analysis": ["aiTools"],
  backtesting: ["backtest", "aiTools"],
  "prop-firm": ["propFirm", "futures", "bots"],
};

/**
 * Features visible for a profile. No profile / not onboarded → everything
 * (back-compat: existing users see the full UI until they finish the wizard).
 */
export function featuresFor(profile: UserProfile | undefined): Set<FeatureKey> {
  const ALL: FeatureKey[] = [
    "scanner",
    "bots",
    "futures",
    "propFirm",
    "pnl",
    "backtest",
    "aiTools",
  ];
  if (!profile?.onboarded || profile.interests.length === 0) {
    return new Set(ALL);
  }
  const out = new Set<FeatureKey>();
  for (const interest of profile.interests) {
    for (const f of INTEREST_FEATURES[interest] ?? []) out.add(f);
  }
  return out;
}
