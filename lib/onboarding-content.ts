/**
 * Onboarding content — broker setup instructions and guide step templates.
 */

export interface BrokerInfo {
  id: string;
  label: string;
  /** Shown inline in the wizard when picked. */
  inlineSteps?: string[];
  /** Emailed on request for brokers with longer flows. */
  emailSubject?: string;
  emailBody?: string;
}

export const BROKERS: BrokerInfo[] = [
  {
    id: "alpaca",
    label: "Alpaca (stocks & crypto, free paper trading)",
    inlineSteps: [
      "1. Sign up at alpaca.markets (free — paper account works immediately)",
      "2. Dashboard → 'Paper Trading' overview → 'View' → 'API Keys'",
      "3. Click 'Generate New Key' — copy the Key ID + Secret",
      "4. In this app: Admin → Trading accounts → '+ Alpaca' — owner = your login email, Key ID in 'API key', Secret in 'API secret'",
      "Or for a shared setup: set APCA_API_KEY_ID / APCA_API_SECRET_KEY in .env.local",
    ],
    emailSubject: "Alpaca API key setup — paper trading",
    emailBody: `Alpaca paper trading setup:

1. Sign up at https://alpaca.markets (free — a paper account works immediately, no funding needed)
2. In the Alpaca dashboard, open "Paper Trading" → Overview → "API Keys"
3. Click "Generate New Key" — copy the Key ID and Secret (the secret shows once)
4. Back in the app: Admin → Trading accounts → add an Alpaca account with your login email as owner — Key ID goes in "API key", Secret in "API secret"

Alternative (shared/fallback): set APCA_API_KEY_ID and APCA_API_SECRET_KEY in the app's environment.`,
  },
  {
    id: "topstep",
    label: "TopStep / TopStepX (futures prop firm)",
    inlineSteps: [
      "TopStepX → Settings → API → 'Generate API Key'",
      "Username = your TopStepX platform login (often your email)",
      "Note your numeric account ID (Accounts list, e.g. 28xxxxxx)",
      "Admin → Trading accounts → TopStep: username in 'API key', API key in 'API secret', account ID in 'Account ID'",
    ],
    emailSubject: "TopStepX ProjectX API key setup",
    emailBody: `TopStepX (ProjectX) API setup:

1. Log in to the TopStepX trading platform
2. Settings → API → "Generate API Key" — copy it (shown once)
3. Your username is your TopStepX platform login (for many accounts this is your email address)
4. Find your numeric Account ID in the Accounts list (e.g. 28xxxxxx) — this pins which account trades
5. Back in the app: Admin → Trading accounts → add a "TopStep" account: username in "API key", the ProjectX API key in "API secret", the numeric ID in "Account ID"`,
  },
  {
    id: "apex",
    label: "Apex Trader Funding (futures prop firm)",
    emailSubject: "Apex ProjectX API key setup",
    emailBody: `Apex Trader Funding (ProjectX) API setup:

1. Log in to your Apex Tradovate/ProjectX dashboard
2. Settings → API → generate an API key (copy immediately — shown once)
3. Username = your platform login name
4. Find your numeric Account ID in the Accounts list
5. Back in the app: Admin → Trading accounts → add an "Apex" account: username in "API key", API key in "API secret", account ID in "Account ID"`,
  },
  {
    id: "schwab",
    label: "Charles Schwab / thinkorswim",
    emailSubject: "Schwab developer API setup",
    emailBody: `Charles Schwab API setup:

1. Register at developer.schwab.com and create a developer app
2. Choose the "Trader API — Individual" product and subscribe
3. Set your app's callback URL (e.g. https://localhost:3000 for development)
4. Wait for app approval ("Ready to use" status — can take a few days)
5. Use the app's App Key + App Secret for OAuth — Schwab's flow requires browser sign-in
6. Back in the app: Admin → Trading accounts → add a "Schwab" account (key/secret fields)

Note: Schwab OAuth tokens expire — a full integration needs the token-refresh flow.`,
  },
  {
    id: "forex",
    label: "FOREX.com (FX / CFD)",
    inlineSteps: [
      "Open a FOREX.com account — a free demo account works",
      "Request an API AppKey from support.en@forex.com (up to 3 business days)",
      "Set FOREX_USERNAME / FOREX_PASSWORD / FOREX_APP_KEY in .env.local",
      "Check Settings → Platforms — FOREX.com should show 'Connected' with equity",
    ],
    emailSubject: "FOREX.com REST API setup",
    emailBody: `FOREX.com REST API (GAIN Capital TradingAPI) setup:

1. Open a FOREX.com account — demo accounts work with the same API
2. Request API access / an AppKey from support.en@forex.com (allow up to 3 business days)
3. In the app's environment set:
   FOREX_USERNAME=<platform username>
   FOREX_PASSWORD=<account password>
   FOREX_APP_KEY=<AppKey from support>
   (FOREX_BASE_URL optional — defaults to the GAIN gateway)
4. Verify: GET /api/platforms — the FOREX.com entry shows configured + connected with your equity`,
  },
  {
    id: "ninjatrader",
    label: "NinjaTrader (futures)",
    emailSubject: "NinjaTrader API setup",
    emailBody: `NinjaTrader API setup:

1. NinjaTrader 8 desktop → Control Center → Connections → configure your brokerage connection
2. For automation, enable the NinjaScript/ATi interface or use NinjaTrader's cloud APIs via your prop firm
3. If routing through Tradovate/ProjectX (Apex/Bulenox accounts), use those platform credentials instead — they're supported directly
4. Back in the app: Admin → Trading accounts → add a "NinjaTrader" account with your credentials`,
  },
  {
    id: "ibkr",
    label: "Interactive Brokers",
    emailSubject: "Interactive Brokers API setup",
    emailBody: `Interactive Brokers API setup:

1. In Client Portal: Settings → API → enable "Read-Only API" and note your account ID
2. For trading automation, IBKR requires the Client Portal Gateway or TWS API running locally
3. Paper account: request one from Account Management if you don't see it
4. IBKR's gateway runs on your machine — a cloud deployment needs a hosted gateway or a different execution path`,
  },
];

export const TRADING_STYLES = [
  { id: "scalp", label: "Scalping — seconds to minutes" },
  { id: "day", label: "Day trading — intraday, flat by close" },
  { id: "swing", label: "Swing — days to weeks" },
  { id: "invest", label: "Position / long-term" },
] as const;

export const INTERESTS: { id: import("@/lib/scanner/types").InterestKey; label: string; desc: string }[] = [
  { id: "premarket", label: "Pre-market reports", desc: "Gapper + setup scanners with catalysts and alerts" },
  { id: "technical-analysis", label: "Technical analysis", desc: "Indicators, AI indicators, drawing tools, sessions" },
  { id: "backtesting", label: "Backtesting", desc: "Test strategies on historical data before trading" },
  { id: "bots", label: "Automated bots", desc: "Run strategies live on Alpaca/TopStep/Apex" },
  { id: "live-trading", label: "Live/paper trading", desc: "Order tickets, positions, P&L calendar" },
  { id: "prop-firm", label: "Prop firm challenge", desc: "Challenge calculator + challenge-safe bot setups" },
];

/** Per-interest step-by-step guide shown on the dashboard. */
export const GUIDE_STEPS: Record<string, { id: string; label: string; hint?: string }[]> = {
  "live-trading": [
    { id: "link-acct", label: "Link a trading account", hint: "Admin → Trading accounts" },
    { id: "place-trade", label: "Place a paper order", hint: "⚡ Futures ticket or the Alpaca ticket on a chart" },
    { id: "check-pnl", label: "Review your P&L calendar", hint: "📅 P&L button in the header" },
  ],
  premarket: [
    { id: "watchlist", label: "Create a watchlist", hint: "📡 Scanner → ★ Save your universe" },
    { id: "run-scan", label: "Run a gappers scan", hint: "📡 Scanner → Premarket Gappers" },
    { id: "telegram", label: "Connect Telegram alerts", hint: "Scanner → Schedules & Alerts" },
    { id: "schedule", label: "Enable a scheduled scan", hint: "Scanner → Schedules & Alerts → ⏱" },
  ],
  bots: [
    { id: "strategy", label: "Create an AI strategy", hint: "Backtest → AI strategy, or the Bots create form" },
    { id: "deploy-bot", label: "Deploy a bot", hint: "🤖 Bots → + New, or a scanner hit's 🤖 button" },
    { id: "monitor", label: "Watch the event log", hint: "Bot detail → Trade event log" },
  ],
  "prop-firm": [
    { id: "link-prop", label: "Link your TopStep/Apex account", hint: "Admin → Trading accounts (username + API key + Account ID)" },
    { id: "calc", label: "Calculate your challenge plan", hint: "🧮 Prop Firm" },
    { id: "deploy-challenge", label: "Deploy the plan as a bot", hint: "Calculator → 🤖 Implement as Bot" },
  ],
  backtesting: [
    { id: "pick-chart", label: "Open a chart and run Backtest", hint: "Chart pane → Backtest button" },
    { id: "ai-strat", label: "Generate a strategy with AI", hint: "Backtest → AI-generated strategy" },
    { id: "iterate", label: "Compare runs and iterate", hint: "Adjust params, re-run" },
  ],
};
