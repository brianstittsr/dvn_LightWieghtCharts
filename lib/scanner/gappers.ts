/**
 * Premarket gapper scanner (the article's "Scanner A").
 *
 * Universe: Alpaca's gainers screener (/v1beta1/screener/stocks/movers), with a
 * snapshot-computed fallback for plans where the screener path isn't enabled.
 * Filters, premarket volume (1m bars 04:00–09:29 ET), and news catalysts via
 * the Alpaca news API — with an optional one-line GPT summary.
 */
import { alpacaData, alpacaDataRaw } from "@/lib/alpaca";
import { etNow, etToUtc } from "@/lib/scanner/types";
import type { GapperFilters, GapperResult } from "@/lib/scanner/types";

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

/**
 * Run the gapper scan. Cheap filters on the universe first, then the
 * expensive per-ticker work (PM volume, news) only on survivors.
 */
export async function runGappersScan(
  filters: GapperFilters,
): Promise<GapperResult[]> {
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
