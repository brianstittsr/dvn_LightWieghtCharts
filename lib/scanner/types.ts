/**
 * Shared types for the scanner modules (premarket gappers + setup scanner)
 * and their persistence (configs, run history, per-user notification prefs).
 */

export type ScannerKind = "gappers" | "setup";

/** Asset classes supported by the scanners and watchlists. */
export type AssetClass = "stock" | "crypto" | "future";

/** Per-user saved symbol universe for scanning. */
export interface Watchlist {
  id: string;
  uid: string;
  name: string;
  assetClass: AssetClass;
  symbols: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface GapperResult {
  rank: number;
  symbol: string;
  price: number;
  gapPct: number;
  premarketVolume: number;
  catalyst: string | null;
  headlines: string[];
}

export interface SetupResult {
  symbol: string;
  result: "PASS" | "fail_daily" | "fail_intraday" | "error";
  currPrice?: number;
  prevDailyHigh?: number;
  prevDailyClose?: number;
  sma200?: number;
  pmh?: number;
  todayHod?: number;
  reason?: string;
}

/** A persisted scan execution — one per run, owner-scoped. */
export interface ScanRun {
  id: string;
  kind: ScannerKind;
  ownerUid: string;
  assetClass: AssetClass;
  configId?: string;
  ranAt: string;
  gappers?: GapperResult[];
  setups?: SetupResult[];
  error?: string;
}

// ── Configs ─────────────────────────────────────────────────────────────────

export interface GapperFilters {
  minGapPct: number;
  minPrice: number;
  minPremarketVolume: number;
  topN: number;
}

export const DEFAULT_GAP_FILTERS: GapperFilters = {
  minGapPct: 5,
  minPrice: 3,
  minPremarketVolume: 50_000,
  topN: 10,
};

export interface ScanSchedule {
  enabled: boolean;
  /** ET minutes since midnight — e.g. 510 = 08:30. */
  windowStartEt: number;
  windowEndEt: number;
  /** Fire at most once per this-many-minute slot inside the window. */
  intervalMin: number;
  weekdaysOnly: boolean;
}

export const DEFAULT_SCHEDULES: Record<ScannerKind, ScanSchedule> = {
  gappers: { enabled: false, windowStartEt: 480, windowEndEt: 570, intervalMin: 1440, weekdaysOnly: true },
  setup: { enabled: false, windowStartEt: 600, windowEndEt: 840, intervalMin: 30, weekdaysOnly: true },
};

/** Saved scanner definition — what to scan, on which universe, when. */
export interface ScannerConfig {
  id: string;
  ownerUid: string;
  kind: ScannerKind;
  name: string;
  assetClass: AssetClass;
  filters?: GapperFilters;
  /** Setup scanner universe (uppercase symbols). */
  universe?: string[];
  /** "trend-join-long" builtin or a saved custom strategy. */
  strategyId?: string;
  strategyCode?: string;
  strategyParams?: Record<string, number>;
  schedule: ScanSchedule;
  /** Dedupes notification sends (first-run/day, new-hit, error). */
  lastNotifiedKey?: string;
  /** Dedupes slot firing within the schedule window. */
  lastSlotKey?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Per-user settings ───────────────────────────────────────────────────────

/** userSettings/{uid} — notification prefs; secrets never leave the server. */
export interface UserSettings {
  id: string;
  uid: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  /** First-login onboarding answers + guide progress. */
  profile?: UserProfile;
  updatedAt: string;
}

export type InterestKey =
  | "backtesting"
  | "bots"
  | "live-trading"
  | "technical-analysis"
  | "premarket"
  | "prop-firm";

export interface UserProfile {
  onboarded: boolean;
  tradingStyles: string[];
  experience: "beginner" | "intermediate" | "advanced";
  /** e.g. "alpaca", "topstep", "schwab", "ninjatrader", "forex", "ibkr", "none". */
  brokers: string[];
  interests: InterestKey[];
  /** Checked-off guide step ids. */
  guideProgress: Record<string, boolean>;
  guideDismissed?: boolean;
  completedAt?: string;
}

// ── ET clock helpers (scheduler + PMH/HOD math share these) ─────────────────

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

export interface EtNow {
  /** "YYYY-MM-DD" in New York. */
  dateKey: string;
  /** Minutes since midnight ET. */
  minutes: number;
  /** JS weekday (0=Sun). */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function etNow(now = new Date()): EtNow {
  const parts = Object.fromEntries(
    ET_FMT.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

const ET_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" in New York for an arbitrary instant. */
export function etDateKey(d: Date): string {
  const parts = Object.fromEntries(
    ET_DATE.formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** ET wall-clock on a date → real UTC instant (DST-safe, server-tz-agnostic). */
export function etToUtc(dateKey: string, hh: number, mm: number): Date {
  const guess = new Date(
    `${dateKey}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`,
  );
  const etWall = new Date(
    guess.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const utcWall = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (etWall.getTime() - utcWall.getTime()));
}
