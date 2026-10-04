/**
 * Server-side crypto news aggregator — merges public RSS feeds
 * (CoinDesk, CoinTelegraph, Decrypt), tags each item with the coins it
 * mentions, caches for 5 minutes. No API keys required.
 */

export interface CryptoNewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  snippet: string;
  /** Coins detected in the headline/snippet (empty = general market news). */
  coins: string[];
}

const FEEDS: { name: string; url: string }[] = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
];

/** Coin keyword map — covers the app's listed assets + common majors. */
const COIN_KEYWORDS: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether", "eth "],
  SOL: ["solana", " sol "],
  DOGE: ["dogecoin", "doge"],
  HYPE: ["hyperliquid", "hype token"],
  ARB: ["arbitrum", "arb token"],
  XRP: ["xrp", "ripple"],
  ADA: ["cardano", " ada "],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", " link "],
};

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; items: CryptoNewsItem[] } | null = null;

const decodeEntities = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#\d+;/g, "");

const stripTags = (s: string): string =>
  decodeEntities(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function pick(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1] ?? "";
}

function tagCoins(text: string): string[] {
  const hay = ` ${text.toLowerCase()} `;
  const out: string[] = [];
  for (const [coin, kws] of Object.entries(COIN_KEYWORDS)) {
    if (kws.some((k) => hay.includes(k))) out.push(coin);
  }
  return out;
}

function parseRss(xml: string, source: string): CryptoNewsItem[] {
  const items: CryptoNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks.slice(0, 40)) {
    const title = stripTags(pick(b, "title"));
    const link = decodeEntities(pick(b, "link")).trim();
    const pub = pick(b, "pubDate") || pick(b, "dc:date");
    const snippet = stripTags(pick(b, "description")).slice(0, 240);
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      source,
      publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      snippet,
      coins: tagCoins(`${title} ${snippet}`),
    });
  }
  return items;
}

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (news aggregator)" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return res.text();
}

/** Merged, deduped, newest-first crypto news — 5-minute cache. */
export async function cryptoNews(): Promise<CryptoNewsItem[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => parseRss(await fetchFeed(f.url), f.name)),
  );
  const seen = new Set<string>();
  const items: CryptoNewsItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = item.title.toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const capped = items.slice(0, 80);
  cache = { at: Date.now(), items: capped };
  return capped;
}

/** Headlines mentioning a coin — for scanner catalysts. */
export async function headlinesFor(coin: string, limit = 3): Promise<string[]> {
  const items = await cryptoNews();
  return items
    .filter((i) => i.coins.includes(coin.toUpperCase()))
    .slice(0, limit)
    .map((i) => i.title);
}
