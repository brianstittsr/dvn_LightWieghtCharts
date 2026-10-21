/**
 * Shared Loom video resolution — extracts the video id from a share URL and
 * resolves the downloadable MP4 through Loom's GraphQL API.
 *
 * The working path (verified Oct 2026):
 *   Query.getVideo(id).nullableRawCdnUrl(acceptableMimes: [MP4]) { url }
 * returns a signed CloudFront MP4 URL — no auth needed for public videos.
 * Fallback: scrape the share page for a transcoded mp4 link.
 */

export interface LoomVideoInfo {
  /** Signed URL — either an .mp4 file or an HLS (.m3u8) master playlist. */
  url: string;
  /** "mp4" for direct file, "hls" for adaptive stream needing remux. */
  kind: "mp4" | "hls";
  /** Video title, if the API returned it. */
  title: string | null;
}

/** Extract the 32-char video id from any Loom share/embed URL. */
export function extractLoomVideoId(url: string): string | null {
  const m = url.match(/loom\.com\/(?:share|embed|v)\/([0-9a-f]{32})/i);
  return m?.[1] ?? null;
}

async function resolveViaGraphql(id: string): Promise<LoomVideoInfo | null> {
  const res = await fetch("https://www.loom.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://www.loom.com",
      Referer: `https://www.loom.com/share/${id}`,
      "apollographql-client-name": "loom-web",
      "x-loom-request-source": "loom_web_0.0.0",
    },
    body: JSON.stringify({
      operationName: "GetVideo",
      variables: { videoId: id },
      query: `query GetVideo($videoId: ID!) {
        getVideo(id: $videoId) {
          ... on RegularUserVideo {
            name
            nullableRawCdnUrl(acceptableMimes: [MP4, M3U8]) { url }
          }
          ... on PrivateVideo { __typename }
          ... on VideoPasswordMissingOrIncorrect { __typename }
        }
      }`,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    data?: {
      getVideo?: {
        name?: string;
        nullableRawCdnUrl?: { url?: string } | null;
      } | null;
    };
  } | null;
  const video = data?.data?.getVideo;
  const url = video?.nullableRawCdnUrl?.url;
  if (!url) return null;
  return {
    url,
    kind: url.includes(".m3u8") ? "hls" : "mp4",
    title: video?.name?.trim() || null,
  };
}

async function resolveViaPageScrape(id: string): Promise<LoomVideoInfo | null> {
  const res = await fetch(`https://www.loom.com/share/${id}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m =
    html.match(/https:\/\/cdn\.loom\.com\/sessions\/transcoded\/[^"\\]+\.mp4[^"\\]*/i) ??
    html.match(/"url"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/i);
  const url = m ? m[0].replace(/^"url"\s*:\s*"/, "").replace(/\\u0026/g, "&") : null;
  const t = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/ \| Loom$/i, "").trim();
  return url
    ? { url, kind: url.includes(".m3u8") ? ("hls" as const) : ("mp4" as const), title: t || null }
    : null;
}

/**
 * Resolve a Loom share URL to a downloadable MP4 + title, or null.
 * Only works for publicly-shared videos.
 */
export async function resolveLoomVideo(id: string): Promise<LoomVideoInfo | null> {
  return (
    (await resolveViaGraphql(id).catch(() => null)) ??
    (await resolveViaPageScrape(id).catch(() => null))
  );
}

/** Fetch the public share page's title for markdown headers. */
export async function loomVideoTitle(id: string): Promise<string | null> {
  const res = await fetch(`https://www.loom.com/share/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
  }).catch(() => null);
  if (!res?.ok) return null;
  const html = await res.text();
  const m = html.match(/<title>([^<]+)<\/title>/i) ?? html.match(/"name"\s*:\s*"([^"]+)"/);
  const raw = m?.[1]?.trim();
  return raw ? raw.replace(/ \| Loom$/i, "") : null;
}
