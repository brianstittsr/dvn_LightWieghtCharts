/** Supported broker/prop-firm platforms and how to connect them. */

export interface PlatformDef {
  id: string;
  name: string;
  kind: "broker" | "prop" | "desktop";
  /** Env vars required for the platform to be considered configured. */
  envVars: string[];
  /** Short setup instructions shown when not configured. */
  setup: string;
  capabilities: string[];
}

export const PLATFORMS: PlatformDef[] = [
  {
    id: "alpaca",
    name: "Alpaca",
    kind: "broker",
    envVars: ["APCA_API_KEY_ID / ALPACA_API_KEY", "APCA_API_SECRET_KEY / ALPACA_API_SECRET"],
    setup: "Already powering this dashboard — keys live in .env.local.",
    capabilities: ["Paper trading", "Stocks + crypto + options", "Positions", "Orders", "P&L"],
  },
  {
    id: "topstep",
    name: "TopStep",
    kind: "prop",
    envVars: ["TOPSTEP_USERNAME", "TOPSTEP_API_KEY"],
    setup:
      "TopStepX uses the ProjectX API. Sign in at topstepx.com → Settings > API (topstepx.com/settings?tab=api) → generate a key. TOPSTEP_USERNAME is your platform login name — NOT your email. Set both in .env.local.",
    capabilities: ["Eval/funded account balance", "Positions", "Futures orders"],
  },
  {
    id: "apex",
    name: "Apex Trader",
    kind: "prop",
    envVars: ["APEX_USERNAME", "APEX_API_KEY", "APEX_BASE_URL (optional override)"],
    setup:
      "Apex accounts on the ProjectX stack use the same loginKey auth. Set APEX_USERNAME and APEX_API_KEY in .env.local (APEX_BASE_URL only if your account uses a different gateway).",
    capabilities: ["Eval/funded account balance", "Positions", "Futures orders"],
  },
  {
    id: "forex",
    name: "FOREX.com",
    kind: "broker",
    envVars: ["FOREX_USERNAME", "FOREX_PASSWORD", "FOREX_APP_KEY", "FOREX_BASE_URL (optional)"],
    setup:
      "FOREX.com uses the GAIN Capital TradingAPI. Open an account (demo works), request an API AppKey from support.en@forex.com, then Admin → Trading accounts → add a FOREX.com account: username → 'API key', password → 'API secret', AppKey → 'AppKey'. Env vars are the shared fallback.",
    capabilities: ["Account balance", "Trading accounts", "80+ FX/CFD markets via REST"],
  },
  {
    id: "ninjatrader",
    name: "NinjaTrader",
    kind: "desktop",
    envVars: [],
    setup:
      "NinjaTrader has no cloud REST API — it only runs as a local desktop app (NT8). Connecting requires a local bridge/ATI add-on on this machine, which isn't implemented yet.",
    capabilities: ["Requires local NT8 bridge — not available"],
  },
  {
    id: "oanda",
    name: "OANDA",
    kind: "broker",
    envVars: ["OANDA_API_TOKEN", "OANDA_ACCOUNT_ID", "OANDA_BASE_URL (optional)"],
    setup:
      "OANDA v20 REST API. Generate a personal access token at fxTrade → My Services → Manage API Access. Your API credentials: token → 'API key', account ID → 'API secret'. Practice accounts use the default base URL.",
    capabilities: ["Account balance", "Open positions", "Market/Limit/Stop orders", "Partial close", "80+ FX pairs"],
  },
  {
    id: "dxtrade",
    name: "DXTrade",
    kind: "prop",
    envVars: ["DXTRADE_USERNAME", "DXTRADE_PASSWORD", "DXTRADE_BASE_URL"],
    setup:
      "DXTrade (Devexperts) — each prop firm runs its own deployment. Your API credentials: username, password, and the base URL of your broker's DXTrade instance (e.g. https://dx.velotrade.com/dxsca-web).",
    capabilities: ["Account info", "Positions", "Market/Limit/Stop orders", "Partial close"],
  },
  {
    id: "ctrader",
    name: "cTrader",
    kind: "broker",
    envVars: ["CTRADER_CLIENT_ID", "CTRADER_CLIENT_SECRET", "CTRADER_ACCESS_TOKEN", "CTRADER_ACCOUNT_ID"],
    setup:
      "cTrader Open API uses OAuth2. Register an app on the cTrader Open API portal, authorize your account, then enter: access token → 'API key', clientId:clientSecret → 'API secret', account ID → 'Account ID'. Trading requires WebSocket — account probe only via REST.",
    capabilities: ["Account info (REST probe)", "Trading via cTrader desktop/web"],
  },
  {
    id: "ftmo",
    name: "FTMO",
    kind: "prop",
    envVars: ["FTMO_LOGIN", "FTMO_SECRET", "FTMO_BACKEND (ctrader/dxtrade/mt4/mt5)"],
    setup:
      "FTMO has no proprietary API — it routes through cTrader, DXTrade, or MetaTrader. Select your backend (cTrader recommended), then enter your platform credentials. DXTrade REST was revoked Apr 2024.",
    capabilities: ["Eval/funded account", "Trades via cTrader Open API", "Account probe"],
  },
  {
    id: "matchtrade",
    name: "Match-Trader",
    kind: "broker",
    envVars: ["MATCHTRADE_EMAIL", "MATCHTRADE_PASSWORD", "MATCHTRADE_BROKER_ID", "MATCHTRADE_BASE_URL"],
    setup:
      "Match-Trader REST API. Your API credentials: email → 'API key', password → 'API secret', base URL → 'AppKey / URL'. Broker ID goes in 'Notes'. Each broker deployment has its own host.",
    capabilities: ["Account balance", "Positions", "Orders", "Partial close"],
  },
  {
    id: "schwab",
    name: "Charles Schwab",
    kind: "broker",
    envVars: ["SCHWAB_APP_KEY", "SCHWAB_APP_SECRET", "SCHWAB_REFRESH_TOKEN"],
    setup:
      "Register an app at developer.schwab.com, complete the OAuth2 flow to get a refresh token, then set SCHWAB_APP_KEY / SCHWAB_APP_SECRET / SCHWAB_REFRESH_TOKEN in .env.local.",
    capabilities: ["Account balances", "Positions", "Orders (after OAuth)"],
  },
];

export function platformConfigured(id: string): boolean {
  switch (id) {
    case "alpaca":
      return Boolean(
        (process.env.APCA_API_KEY_ID ?? process.env.ALPACA_API_KEY) &&
          (process.env.APCA_API_SECRET_KEY ?? process.env.ALPACA_API_SECRET),
      );
    case "topstep":
      return Boolean(process.env.TOPSTEP_USERNAME && process.env.TOPSTEP_API_KEY);
    case "apex":
      return Boolean(process.env.APEX_USERNAME && process.env.APEX_API_KEY);
    case "forex":
      return Boolean(
        process.env.FOREX_USERNAME && process.env.FOREX_PASSWORD && process.env.FOREX_APP_KEY,
      );
    case "oanda":
      return Boolean(process.env.OANDA_API_TOKEN && process.env.OANDA_ACCOUNT_ID);
    case "dxtrade":
      return Boolean(
        process.env.DXTRADE_USERNAME && process.env.DXTRADE_PASSWORD && process.env.DXTRADE_BASE_URL,
      );
    case "ctrader":
      return Boolean(
        process.env.CTRADER_CLIENT_ID && process.env.CTRADER_ACCESS_TOKEN && process.env.CTRADER_ACCOUNT_ID,
      );
    case "ftmo":
      return Boolean(process.env.FTMO_LOGIN && process.env.FTMO_SECRET);
    case "matchtrade":
      return Boolean(
        process.env.MATCHTRADE_EMAIL && process.env.MATCHTRADE_PASSWORD &&
        process.env.MATCHTRADE_BROKER_ID && process.env.MATCHTRADE_BASE_URL,
      );
    case "schwab":
      return Boolean(
        process.env.SCHWAB_APP_KEY && process.env.SCHWAB_APP_SECRET && process.env.SCHWAB_REFRESH_TOKEN,
      );
    case "ninjatrader":
      return false;
    default:
      return false;
  }
}
