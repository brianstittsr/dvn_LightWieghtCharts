import { NextResponse } from "next/server";
import { alpaca, AlpacaError } from "@/lib/alpaca";

export const dynamic = "force-dynamic";

/** Calendar-day bucket in New York time (trading convention). */
const etDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const etDay = (unix: number): string => etDayFmt.format(new Date(unix * 1000));

/** One fill row in a day's drill-down (per-fill realized P&L via FIFO). */
export interface DayTrade {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  time: string; // ISO transaction_time
  /** Realized P&L from this fill's closing portion (0 for pure opens). */
  realized: number;
  /** Qty that closed existing lots (0 => still-open fill). */
  closedQty: number;
  assetClass: "stock" | "option";
}

export interface DayPnl {
  date: string; // YYYY-MM-DD (ET)
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  /** Fills that opened/added to a position without closing any qty. */
  opens: number;
  /** Per-fill rows for the drill-down. */
  details: DayTrade[];
}

interface PortfolioHistory {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
}

interface FillActivity {
  id: string;
  activity_type: string;
  symbol: string;
  side: "buy" | "sell";
  qty: string;
  price: string;
  transaction_time: string;
}

interface Lot {
  qty: number;
  price: number;
  side: "long" | "short";
}

/** OCC option symbol: 1-6 letter root + YYMMDD + C/P + 8-digit strike. */
const OCC_OPTION = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
const assetClassOf = (symbol: string): DayTrade["assetClass"] =>
  OCC_OPTION.test(symbol) ? "option" : "stock";

interface DayStats {
  trades: number;
  wins: number;
  losses: number;
  opens: number;
  details: DayTrade[];
}
const emptyStats = (): DayStats => ({ trades: 0, wins: 0, losses: 0, opens: 0, details: [] });

/**
 * Daily account P&L (equity change) from portfolio history, merged with
 * per-day trade stats computed by FIFO-matching FILL activities per symbol.
 */
export async function GET() {
  try {
    const history = await alpaca<PortfolioHistory>(
      "/v2/account/portfolio/history?period=1A&timeframe=1D",
    );

    // Pull up to 500 recent fills (5 pages of 100, newest first, page_token paging).
    const fills: FillActivity[] = [];
    let pageToken = "";
    for (let page = 0; page < 5; page++) {
      const qs = `activity_types=FILL&page_size=100&direction=desc${pageToken ? `&page_token=${pageToken}` : ""}`;
      const batch = await alpaca<FillActivity[]>(`/v2/account/activities?${qs}`);
      fills.push(...batch);
      if (batch.length < 100) break;
      pageToken = batch[batch.length - 1].id;
    }

    // FIFO match fills oldest → newest; a closing fill's realized P&L decides win/loss.
    const lots = new Map<string, Lot[]>();
    const dayStats = new Map<string, DayStats>();
    const sorted = [...fills].sort(
      (a, b) => new Date(a.transaction_time).getTime() - new Date(b.transaction_time).getTime(),
    );

    for (const f of sorted) {
      const day = etDay(Math.floor(new Date(f.transaction_time).getTime() / 1000));
      const st = dayStats.get(day) ?? emptyStats();
      st.trades += 1;

      const dir: Lot["side"] = f.side === "buy" ? "long" : "short";
      const qty = Number(f.qty);
      let remaining = qty;
      const price = Number(f.price);
      const queue = lots.get(f.symbol) ?? [];
      let realized = 0;
      let closed = 0;

      while (remaining > 0 && queue.length > 0 && queue[0].side !== dir) {
        const lot = queue[0];
        const take = Math.min(remaining, lot.qty);
        realized +=
          lot.side === "long" ? (price - lot.price) * take : (lot.price - price) * take;
        lot.qty -= take;
        remaining -= take;
        closed += take;
        if (lot.qty <= 1e-9) queue.shift();
      }
      if (remaining > 1e-9) queue.push({ qty: remaining, price, side: dir });
      lots.set(f.symbol, queue);

      if (closed > 0) {
        if (realized > 0) st.wins += 1;
        else if (realized < 0) st.losses += 1;
      } else {
        // Pure open/add — nothing closed, like TickerScribe's "O" badge.
        st.opens += 1;
      }
      st.details.push({
        symbol: f.symbol,
        side: f.side,
        qty,
        price,
        time: f.transaction_time,
        realized,
        closedQty: closed,
        assetClass: assetClassOf(f.symbol),
      });
      dayStats.set(day, st);
    }

    const days: DayPnl[] = [];
    for (let i = 0; i < history.timestamp.length; i++) {
      const date = etDay(history.timestamp[i]);
      const stats = dayStats.get(date);
      days.push({
        date,
        pnl: history.profit_loss[i] ?? 0,
        trades: stats?.trades ?? 0,
        wins: stats?.wins ?? 0,
        losses: stats?.losses ?? 0,
        opens: stats?.opens ?? 0,
        details: stats?.details ?? [],
      });
    }
    // Fills can exist on days with no portfolio-history point (e.g. today).
    for (const [date, st] of dayStats) {
      if (!days.some((d) => d.date === date)) {
        days.push({
          date,
          pnl: 0,
          trades: st.trades,
          wins: st.wins,
          losses: st.losses,
          opens: st.opens,
          details: st.details,
        });
      }
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ data: { days } });
  } catch (err) {
    const status = err instanceof AlpacaError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load P&L" },
      { status },
    );
  }
}
