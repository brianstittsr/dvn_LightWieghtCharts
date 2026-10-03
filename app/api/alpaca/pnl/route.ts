import { NextRequest, NextResponse } from "next/server";
import { alpaca, AlpacaError } from "@/lib/alpaca";
import {
  projectxContractById,
  projectxOrderHistory,
  userCredsFor,
} from "@/lib/platforms/projectx";
import { verifyUser } from "@/lib/server-auth";

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
  assetClass: "stock" | "option" | "future";
  /** $ per 1.00 price point (futures: tickValue/tickSize; stocks/options: 1). */
  multiplier: number;
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

/** Normalized fill shared by Alpaca activities and ProjectX orders. */
interface NormFill {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  time: string;
  assetClass: DayTrade["assetClass"];
  multiplier: number;
}

interface Lot {
  qty: number;
  price: number;
  side: "long" | "short";
  mult: number;
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
 * per-day trade stats computed by FIFO-matching FILL activities per symbol —
 * plus futures fills from the caller's linked TopStep account, FIFO-matched
 * per contract with realized P&L scaled by the contract's point value.
 */
export async function GET(req: NextRequest) {
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

    // Normalize everything into one fill list (stocks/options + futures).
    const norm: NormFill[] = fills.map((f) => ({
      symbol: f.symbol,
      side: f.side,
      qty: Number(f.qty),
      price: Number(f.price),
      time: f.transaction_time,
      assetClass: assetClassOf(f.symbol),
      multiplier: 1,
    }));

    // ── Futures fills (TopStep via the caller's linked account) ─────────
    const futResolved = await userCredsFor("topstep", await verifyUser(req)).catch(
      () => null,
    );
    if (futResolved?.accountId) {
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 32 * 864e5);
        const orders = await projectxOrderHistory(
          futResolved.creds,
          futResolved.accountId,
          start.toISOString(),
          end.toISOString(),
        );
        const meta = new Map<string, { name: string; mult: number }>();
        for (const o of orders) {
          if (o.status !== 2) continue; // Filled only
          const price = o.filledPrice ?? o.avgFillPrice;
          const qty = o.fillVolume ?? o.size;
          if (!price || !qty) continue;
          let m = meta.get(o.contractId);
          if (!m) {
            const c = await projectxContractById(futResolved.creds, o.contractId).catch(
              () => null,
            );
            m = {
              name: c?.name ?? o.contractId,
              mult: c && c.tickSize > 0 ? c.tickValue / c.tickSize : 1,
            };
            meta.set(o.contractId, m);
          }
          norm.push({
            symbol: m.name,
            side: o.side === 0 ? "buy" : "sell",
            qty,
            price,
            time: o.updateTimestamp ?? o.creationTimestamp ?? end.toISOString(),
            assetClass: "future",
            multiplier: m.mult,
          });
        }
      } catch (e) {
        console.error("Futures P&L merge failed:", e);
      }
    }

    // FIFO match fills oldest → newest; a closing fill's realized P&L decides win/loss.
    const lots = new Map<string, Lot[]>();
    const dayStats = new Map<string, DayStats>();
    const futDayPnl = new Map<string, number>();
    const sorted = [...norm].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );

    for (const f of sorted) {
      const day = etDay(Math.floor(new Date(f.time).getTime() / 1000));
      const st = dayStats.get(day) ?? emptyStats();
      st.trades += 1;

      const dir: Lot["side"] = f.side === "buy" ? "long" : "short";
      const qty = f.qty;
      let remaining = qty;
      const price = f.price;
      const queue = lots.get(f.symbol) ?? [];
      let realized = 0;
      let closed = 0;

      while (remaining > 0 && queue.length > 0 && queue[0].side !== dir) {
        const lot = queue[0];
        const take = Math.min(remaining, lot.qty);
        realized +=
          (lot.side === "long" ? (price - lot.price) * take : (lot.price - price) * take) *
          f.multiplier;
        lot.qty -= take;
        remaining -= take;
        closed += take;
        if (lot.qty <= 1e-9) queue.shift();
      }
      if (remaining > 1e-9) {
        queue.push({ qty: remaining, price, side: dir, mult: f.multiplier });
      }
      lots.set(f.symbol, queue);

      if (closed > 0) {
        if (realized > 0) st.wins += 1;
        else if (realized < 0) st.losses += 1;
        if (f.assetClass === "future") {
          futDayPnl.set(day, (futDayPnl.get(day) ?? 0) + realized);
        }
      } else {
        // Pure open/add — nothing closed, like TickerScribe's "O" badge.
        st.opens += 1;
      }
      st.details.push({
        symbol: f.symbol,
        side: f.side,
        qty,
        price,
        time: f.time,
        realized,
        closedQty: closed,
        assetClass: f.assetClass,
        multiplier: f.multiplier,
      });
      dayStats.set(day, st);
    }

    const days: DayPnl[] = [];
    for (let i = 0; i < history.timestamp.length; i++) {
      const date = etDay(history.timestamp[i]);
      const stats = dayStats.get(date);
      days.push({
        date,
        pnl: (history.profit_loss[i] ?? 0) + (futDayPnl.get(date) ?? 0),
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
          pnl: futDayPnl.get(date) ?? 0,
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
