# Live Charts Dashboard

Multi-pane live trading dashboard built with Next.js, Tailwind CSS and
[Lightweight Charts](https://github.com/tradingview/lightweight-charts).

## Features

- **Number of charts selector** (1, 2, 4, 6, 8 — max 8) that reshuffles the grid
  into the cleanest layout (1=1×1, 2=2×1, 4=2×2, 6=3×2, 8=4×2) and persists
  your choice in `localStorage`.
- **Live crypto** streamed over websocket from Hyperliquid.
- Each pane has **independent symbol and timeframe dropdowns** plus a
  colour-coded ticker bar that flashes green/red on every price change.
- **Indicators** (ƒx button per pane): SMA, EMA, WMA, Bollinger Bands, Keltner
  and Donchian channels — all with TradingView-style editable params
  (length, source, multiplier, colour). Indicator setups persist per pane.
- **AI custom indicators**: describe an indicator in plain English and the
  app generates + adds it (requires `OPENAI_API_KEY`).
- **Alpaca paper trading**: Buy/Sell order ticket on every pane plus a
  positions/P&L bar at the bottom (requires Alpaca paper API keys).
- **Pluggable data sources**: implement the `DataSource` interface in
  `lib/data-sources.ts` (one file per broker under `lib/sources/`) to swap in
  Alpaca, Binance, Zerodha, Polygon, etc.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. Everything runs locally — no deployment needed.

## Optional API keys (.env.local)

```bash
# Alpaca paper trading (app.alpaca.markets → Paper Trading → API keys)
APCA_API_KEY_ID=...
APCA_API_SECRET_KEY=...

# OpenAI — powers "Generate with AI" custom indicators
OPENAI_API_KEY=...
```

Restart `npm run dev` after adding keys. Without them the dashboard works
fully except order submission and AI indicator generation.

## Adding a data source

1. Create `lib/sources/mybroker.ts` implementing `DataSource`
   (`fetchHistory` + `subscribe`).
2. Register it in `DATA_SOURCES` in `lib/data-sources.ts`.
3. Add its symbols to `lib/symbols.ts`.
