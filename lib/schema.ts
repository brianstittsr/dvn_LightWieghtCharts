/**
 * Firestore schema for the trading dashboard.
 *
 * Dependency-free: `FirestoreTimestamp` is structurally compatible with the
 * Firebase `Timestamp` class (seconds/nanoseconds/toMillis), so these types
 * work with plain REST payloads today and the real SDK later — call sites use
 * `Timestamp.now()` from `firebase/firestore` when writing.
 *
 * Currently backed by local stores (localStorage / data/*.json); migrate by
 * swapping each store's persistence layer — the shapes already match.
 */

export interface FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toMillis(): number;
}

export const COLLECTIONS = {
  USERS: "users",
  TRADING_ACCOUNTS: "tradingAccounts",
  FUTURES_BOTS: "futuresBots",
  APP_SETTINGS: "appSettings",
  JOURNALS: "journals",
  CUSTOM_INDICATORS: "customIndicators",
  CUSTOM_STRATEGIES: "customStrategies",
  BACKTEST_RESULTS: "backtestResults",
  TRADE_ORDERS: "tradeOrders",
  ALERTS: "alerts",
  DRAWINGS: "drawings",
  PNL_DAYS: "pnlDays",
  SHARED_CALENDARS: "sharedCalendars",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

// ── users/{uid} ──────────────────────────────────────────────────────────────
/** App-level profile; `role: "admin"` gates /admin alongside the session cookie. */
export interface UserDoc {
  uid: string;
  displayName: string;
  email?: string;
  role: "admin" | "trader" | "viewer";
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

// ── tradingAccounts/{accountId} ───────────────────────────────────────────────
/**
 * A trading account owned by a user. Raw credentials are NOT stored here —
 * `credentialsRef` points at a secret store (env var name, Vault path, or
 * Cloud Secret Manager resource). The current server-side equivalent is
 * data/users.json, which keeps secrets on disk rather than in Firestore.
 */
export interface TradingAccountDoc {
  ownerUid: string;
  name: string;
  platform: "alpaca" | "topstep" | "apex" | "schwab" | "ninjatrader";
  /** Pointer to where the credentials live — never the credentials themselves. */
  credentialsRef?: string;
  paper: boolean;
  enabled: boolean;
  notes?: string;
  createdAt: FirestoreTimestamp;
}

// ── appSettings/global ───────────────────────────────────────────────────────
/** Singleton doc — mirrors data/settings.json / AppSettings in lib/settings.ts. */
export interface AppSettingsDoc {
  defaultChartCount: number;
  defaultTimeframe: string;
  positionPollMs: number;
  alertsEnabled: boolean;
  backtest: {
    initialCapital: number;
    riskPerTrade: number;
    commission: number;
    slippagePct: number;
  };
  sessions: {
    asiaStart: number; asiaEnd: number;
    londonStart: number; londonEnd: number;
    nyStart: number; nyEnd: number;
  };
  updatedAt: FirestoreTimestamp;
}

// ── journals/{uid}_{YYYY-MM-DD} ───────────────────────────────────────────────
/** Per-day trade journal — the Firestore twin of localStorage pnl-journal:*. */
export interface JournalDoc {
  uid: string;
  /** "YYYY-MM-DD" in America/New_York. */
  date: string;
  mood?: "great" | "good" | "neutral" | "bad";
  followedPlan: boolean;
  notes: string;
  tags?: string[];
  updatedAt: FirestoreTimestamp;
}

// ── customIndicators/{uid}_{name} ─────────────────────────────────────────────
/** AI-generated chart indicators (currently localStorage lwc-custom-indicators). */
export interface CustomIndicatorDoc {
  uid: string;
  name: string;
  description: string;
  code: string;
  params: Record<string, number>;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

// ── customStrategies/{uid}_{name} ─────────────────────────────────────────────
/** AI-generated backtest strategies (currently lwc-custom-strategies). */
export interface CustomStrategyDoc {
  uid: string;
  name: string;
  description: string;
  code: string;
  params: { name: string; label: string; value: number; min?: number; max?: number }[];
  createdAt: FirestoreTimestamp;
}

// ── backtestResults/{resultId} ────────────────────────────────────────────────
/** Saved backtest runs for review/sharing. Trades stored as a subcollection
 *  (backtestResults/{id}/trades/{tradeId}) if full history is needed. */
export interface BacktestResultDoc {
  uid: string;
  symbol: string;
  timeframe: string;
  strategyName: string;
  bars: number;
  initialCapital: number;
  finalCapital: number;
  totalPnl: number;
  returnPercent: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
  runAt: FirestoreTimestamp;
}

// ── tradeOrders/{orderId} ─────────────────────────────────────────────────────
/** Paper orders submitted through the app (Alpaca client_order_id indexed). */
export interface TradeOrderDoc {
  uid: string;
  accountId: string;
  symbol: string;
  assetClass: "stock" | "option" | "crypto";
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit" | "stop" | "stop_limit" | "bracket";
  status: string;
  takeProfit?: number;
  stopLoss?: number;
  filledAvgPrice?: number;
  brokerOrderId: string;
  submittedAt: FirestoreTimestamp;
}

// ── alerts/{alertId} ──────────────────────────────────────────────────────────
/** Fired alert events — session proximity, TP/SL crosses, reversal alerts. */
export interface AlertDoc {
  uid: string;
  kind: "session_proximity" | "tp_hit" | "sl_hit" | "session_reversal";
  symbol: string;
  message: string;
  price: number;
  acknowledged: boolean;
  firedAt: FirestoreTimestamp;
}

// ── drawings/{uid}_{paneId}_{symbol} ──────────────────────────────────────────
/** Persisted chart drawings per pane+symbol (currently localStorage lwc-drawings-*). */
export interface DrawingsDoc {
  uid: string;
  paneId: string;
  symbol: string;
  /** Serialized Drawing[] — mirrors lib/drawing-store shape. */
  drawings: unknown[];
  updatedAt: FirestoreTimestamp;
}

// ── pnlDays/{uid}_{YYYY-MM-DD} ────────────────────────────────────────────────
/** Cached daily P&L aggregates backing the calendar (from /api/alpaca/pnl). */
export interface PnlDayDoc {
  uid: string;
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  opens: number;
  computedAt: FirestoreTimestamp;
}

// ── sharedCalendars/{shareId} ─────────────────────────────────────────────────
/** TickerScribe-style public read-only P&L calendar links (not yet wired). */
export interface SharedCalendarDoc {
  ownerUid: string;
  /** Random unguessable slug — part of the share URL. */
  slug: string;
  monthRange?: { from: string; to: string };
  hideAmounts: boolean;
  views: number;
  revoked: boolean;
  createdAt: FirestoreTimestamp;
}
