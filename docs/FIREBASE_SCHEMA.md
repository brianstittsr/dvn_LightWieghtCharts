# Firebase / Firestore Schema

Typed source of truth: `lib/schema.ts` (`COLLECTIONS` constants + doc interfaces).
Access control: `firestore.rules`. Composite indexes: `firestore.indexes.json`.

All timestamps are `Timestamp` (`Timestamp.now()` on write). All user-owned docs
carry `uid`; queries are scoped `where("uid", "==", auth.uid)` per the rules.

## Collections

| Collection | Doc ID convention | Purpose | Current local equivalent |
|---|---|---|---|
| `users` | `{uid}` (auth uid) | Profile + `role` (`admin`/`trader`/`viewer`) | — |
| `tradingAccounts` | auto-id | Platform accounts per user; `credentialsRef` points at secrets, never stores them | `data/users.json` |
| `appSettings` | `global` (singleton) | App-wide settings edited in `/admin` | `data/settings.json` |
| `journals` | `{uid}_{YYYY-MM-DD}` | Per-day journal: mood, followedPlan, notes, tags | `localStorage pnl-journal:*` |
| `customIndicators` | `{uid}_{name}` | AI-generated indicator code + params | `localStorage lwc-custom-indicators` |
| `customStrategies` | `{uid}_{name}` | AI-generated backtest strategy code + param defs | `localStorage lwc-custom-strategies` |
| `backtestResults` | auto-id | Saved backtest runs (summary metrics) | — |
| `backtestResults/{id}/trades` | auto-id | Individual trades of a run (subcollection) | — |
| `tradeOrders` | auto-id | Order records; `brokerOrderId` links to broker | — |
| `alerts` | auto-id | Fired alerts: session proximity, TP/SL cross, reversals | browser notifications |
| `drawings` | `{uid}_{paneId}_{symbol}` | Chart drawings per pane+symbol | `localStorage lwc-drawings-*` |
| `pnlDays` | `{uid}_{YYYY-MM-DD}` | Cached daily P&L aggregates (FIFO-computed server-side) | `/api/alpaca/pnl` response |
| `sharedCalendars` | auto-id | Public share links (`slug`, `revoked`, `views`) — not yet implemented | — |

## Field notes

- **`tradingAccounts.credentialsRef`** — string pointer only (env var name,
  Vault path, or Secret Manager resource). Raw API keys/secrets must never be
  written to Firestore.
- **`drawings.drawings`** — `unknown[]` blob mirroring the `Drawing[]` union
  from `lib/drawing-store`; Firestore stores it as an array of maps.
- **`pnlDays`** — server-written cache; `computedAt` marks staleness so clients
  can re-pull from `/api/alpaca/pnl` when older than N minutes.
- **`sharedCalendars`** — world-readable only while `revoked == false` (rules
  enforce). `slug` is a random unguessable URL segment, not the doc id.

## Deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes   # set project in .firebaserc first
```

## Migration path

Each feature currently persists locally (localStorage / `data/*.json`).
Migrate one store at a time: swap the read/write layer for Firestore calls
using the doc shapes in `lib/schema.ts` — no shape changes needed.
