/**
 * Premarket gapper scanner (the article's "Scanner A").
 *
 * Universe: Alpaca's gainers screener (/v1beta1/screener/stocks/movers), with a
 * snapshot-computed fallback for plans where the screener path isn't enabled.
 * Filters, premarket volume (1m bars 04:00–09:29 ET), and news catalysts via
 * the Alpaca news API — with an optional one-line GPT summary.
 */
import { alpacaData, alpacaDataRaw } from "@/lib/alpaca";
import { cryptoNews, type CryptoNewsItem } from "@/lib/crypto-news";
import { hlAssetCtxs } from "@/lib/platforms/hyperliquid";
import { barsFor } from "@/lib/scanner/data";
import { CRYPTO_SYMBOLS, FUTURE_SYMBOLS } from "@/lib/symbols";
import { etNow, etToUtc } from "@/lib/scanner/types";
import type {
  AssetClass,
  GapperFilters,
  GapperResult,
} from "@/lib/scanner/types";

/** Default universe for the snapshots fallback — liquid momentum names. */
const FALLBACK_UNIVERSE = (
  process.env.SCANNER_UNIVERSE ??
  "AMD,NVDA,MU,TSLA,SMCI,PLTR,MARA,RIOT,COIN,SOFI,AAPL,MSFT,META,AMZN,GOOGL,AVGO,ARM,INTC,BABA,HOOD"
).split(",");

interface Mover {
  symbol: string;
  percent_change: number;
  change: number;
  price: number;
}
interface MoversResponse {
  gainers: Mover[];
  losers: Mover[];
}

interface SnapshotBar {
  o: number;
  c: number;
  v: number;
}
interface Snapshot {
  latestTrade?: { p: number };
  dailyBar?: SnapshotBar;
  prevDailyBar?: SnapshotBar;
}

/** A candidate that passed the cheap filters; volume/catalyst filled later. */
interface Candidate {
  symbol: string;
  price: number;
  gapPct: number;
}

async function candidatesFromMovers(): Promise<Candidate[]> {
  const res = await alpacaDataRaw<MoversResponse>(
    "/v1beta1/screener/stocks/movers?top=50",
  );
  return (res.gainers ?? []).map((m) => ({
    symbol: m.symbol,
    price: m.price,
    gapPct: m.percent_change,
  }));
}

/** Fallback: compute gaps from per-symbol snapshots over a fixed universe. */
async function candidatesFromSnapshots(): Promise<Candidate[]> {
  const res = await alpacaData<Record<string, Snapshot>>(
    `/v2/stocks/snapshots?symbols=${FALLBACK_UNIVERSE.join(",")}`,
  );
  const out: Candidate[] = [];
  for (const [symbol, s] of Object.entries(res)) {
    const prevC = s.prevDailyBar?.c;
    const open = s.dailyBar?.o;
    const price = s.latestTrade?.p ?? s.dailyBar?.c;
    if (!prevC || !open || !price) continue;
    out.push({ symbol, price, gapPct: ((open - prevC) / prevC) * 100 });
  }
  return out.sort((a, b) => b.gapPct - a.gapPct);
}

/** Shares traded between 04:00 and 09:29 ET today (premarket window). */
async function premarketVolume(symbol: string): Promise<number> {
  const { dateKey } = etNow();
  const start = etToUtc(dateKey, 4, 0).toISOString();
  const cutoff = etToUtc(dateKey, 9, 30);
  const res = await alpacaData<{ bars?: { t: string; v: number }[] }>(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Min&start=${encodeURIComponent(start)}&limit=400`,
  );
  return (res.bars ?? [])
    .filter((b) => new Date(b.t) < cutoff)
    .reduce((sum, b) => sum + b.v, 0);
}

interface NewsItem {
  headline: string;
  symbols: string[];
}

async function fetchHeadlines(symbols: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(symbols.map((s) => [s, []]));
  try {
    const res = await alpacaDataRaw<{ news?: NewsItem[] }>(
      `/v1beta1/news?symbols=${symbols.join(",")}&limit=${symbols.length * 2}&include_content=false`,
    );
    for (const item of res.news ?? []) {
      for (const sym of item.symbols ?? []) {
        const list = map.get(sym);
        if (list && list.length < 2) list.push(item.headline);
      }
    }
  } catch {
    /* news is best-effort — scan still succeeds without catalysts */
  }
  return map;
}

/** One-line "why it gapped" per symbol via GPT — best-effort, batched. */
async function summarizeCatalysts(
  headlines: Map<string, string[]>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const apiKey = process.env.OPENAI_API_KEY;
  const entries = [...headlines.entries()].filter(([, h]) => h.length > 0);
  if (!apiKey || entries.length === 0) return out;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "For each stock, give the one-sentence news catalyst driving the move (earnings, FDA, partnership...). " +
              'Return JSON only: {"catalysts":{"SYM":"sentence"}}',
          },
          {
            role: "user",
            content: entries
              .map(([s, h]) => `${s}: ${h.join(" | ")}`)
              .join("\n"),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const body = await res.json();
    const parsed = JSON.parse(
      (body.choices?.[0]?.message?.content as string) ?? "{}",
    ) as { catalysts?: Record<string, string> };
    for (const [sym, catalyst] of Object.entries(parsed.catalysts ?? {})) {
      if (typeof catalyst === "string") out.set(sym, catalyst);
    }
  } catch {
    /* fall back to headlines-as-catalyst */
  }
  return out;
}

// ── Crypto / futures gappers ──────────────────────────────────────────────────

/** Crypto "gappers": % move vs the previous UTC-day close + 24h USD volume. */
async function scanCrypto(
  filters: GapperFilters,
  universe: string[],
): Promise<GapperResult[]> {
  const [ctxs, news] = await Promise.all([
    hlAssetCtxs(),
    cryptoNews().catch(() => [] as CryptoNewsItem[]),
  ]);
  const out: GapperResult[] = [];
  for (const [i, symbol] of universe.entries()) {
    const ctx = ctxs.get(symbol.toUpperCase());
    if (!ctx || !ctx.prevDayPx) continue;
    const gapPct = ((ctx.markPx - ctx.prevDayPx) / ctx.prevDayPx) * 100;
    if (gapPct < filters.minGapPct || ctx.markPx < filters.minPrice) continue;
    if (ctx.dayNtlVlm < filters.minPremarketVolume) continue;
    const headlines = news
      .filter((n) => n.coins.includes(symbol.toUpperCase()))
      .slice(0, 3)
      .map((n) => n.title);
    out.push({
      rank: i + 1,
      symbol: symbol.toUpperCase(),
      price: ctx.markPx,
      gapPct,
      premarketVolume: Math.round(ctx.dayNtlVlm),
      catalyst: headlines[0] ?? null,
      headlines,
    });
  }
  return out.sort((a, b) => b.gapPct - a.gapPct).map((g, i) => ({ ...g, rank: i + 1 })).slice(0, filters.topN);
}

/**
 * Futures "gappers": current-session open vs prior-session close (daily bars),
 * current price from the latest 1m bar, overnight volume since 18:00 ET.
 */
async function scanFutures(
  filters: GapperFilters,
  universe: string[],
  uid: string | null,
): Promise<GapperResult[]> {
  const out: GapperResult[] = [];
  const { dateKey, minutes } = etNow();
  // Session opens 18:00 ET the prior day when it's before 18:00 ET now.
  const sessionStart =
    minutes < 18 * 60 ? etToUtc(dateKey, 18, 0).getTime() - 86400_000 : etToUtc(dateKey, 18, 0).getTime();
  await Promise.all(
    universe.map(async (root) => {
      try {
        const [daily, five] = await Promise.all([
          barsFor("future", root, "1d", 3, uid),
          barsFor("future", root, "5m", 80, uid),
        ]);
        const prev = daily.at(-2);
        const today = daily.at(-1);
        const curr = five.at(-1)?.close ?? today?.close;
        if (!prev || !today || curr == null) return;
        const gapPct = ((today.open - prev.close) / prev.close) * 100;
        const overnightVol = five
          .filter((b) => b.time * 1000 >= sessionStart)
          .reduce((s, b) => s + (b.volume ?? 0), 0);
        if (gapPct < filters.minGapPct || curr < filters.minPrice) return;
        if (overnightVol < filters.minPremarketVolume) return;
        out.push({
          rank: 0,
          symbol: root.toUpperCase(),
          price: curr,
          gapPct,
          premarketVolume: overnightVol,
          catalyst: null,
          headlines: [],
        });
      } catch {
        /* per-symbol failures skip that contract */
      }
    }),
  );
  return out.sort((a, b) => b.gapPct - a.gapPct).map((g, i) => ({ ...g, rank: i + 1 })).slice(0, filters.topN);
}

/**
 * Run the gapper scan. Stocks use the Alpaca movers/news path; crypto and
 * futures evaluate a symbol universe (watchlist or built-in defaults).
 */
export async function runGappersScan(
  filters: GapperFilters,
  opts: { assetClass?: AssetClass; universe?: string[]; uid?: string | null } = {},
): Promise<GapperResult[]> {
  const assetClass = opts.assetClass ?? "stock";
  if (assetClass === "crypto") {
    const universe = opts.universe?.length
      ? opts.universe
      : CRYPTO_SYMBOLS.map((s) => s.value);
    return scanCrypto(filters, universe);
  }
  if (assetClass === "future") {
    const universe = opts.universe?.length
      ? opts.universe
      : FUTURE_SYMBOLS.map((s) => s.value);
    return scanFutures(filters, universe, opts.uid ?? null);
  }

  let candidates: Candidate[];
  try {
    candidates = await candidatesFromMovers();
  } catch {
    candidates = await candidatesFromSnapshots();
  }
  const cheap = candidates
    .filter((c) => c.gapPct >= filters.minGapPct && c.price >= filters.minPrice)
    .slice(0, filters.topN);
  if (cheap.length === 0) return [];

  // Premarket volume for survivors only — failures keep a 0 (they still show).
  const volumes = await Promise.all(
    cheap.map((c) => premarketVolume(c.symbol).catch(() => 0)),
  );
  const survivors = cheap.filter((c, i) => volumes[i] >= filters.minPremarketVolume);
  if (survivors.length === 0) return [];

  const symbols = survivors.map((c) => c.symbol);
  const headlines = await fetchHeadlines(symbols);
  const catalysts = await summarizeCatalysts(headlines);

  return survivors.map((c, i) => {
    const h = headlines.get(c.symbol) ?? [];
    const idx = cheap.indexOf(c);
    return {
      rank: i + 1,
      symbol: c.symbol,
      price: c.price,
      gapPct: c.gapPct,
      premarketVolume: volumes[idx],
      catalyst: catalysts.get(c.symbol) ?? (h.length > 0 ? h[0] : null),
      headlines: h,
    } satisfies GapperResult;
  });
}
