/**
 * Shared Loom video resolution — extracts the video id from a share URL and
 * resolves the downloadable MP4 through three fallback strategies.
 */

/** Extract the 32-char video id from any Loom share/embed URL. */
export function extractLoomVideoId(url: string): string | null {
  const m = url.match(/loom\.com\/(?:share|embed|v)\/([0-9a-f]{32})/i);
  return m?.[1] ?? null;
}

async function resolveViaSessionsApi(id: string): Promise<string | null> {
  const res = await fetch(`https://www.loom.com/api/campaigns/sessions/${id}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://www.loom.com",
      Referer: `https://www.loom.com/share/${id}`,
    },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { url?: string } | null;
  return data?.url ?? null;
}

async function resolveViaGraphql(id: string): Promise<string | null> {
  const res = await fetch("https://www.loom.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://www.loom.com",
      Referer: `https://www.loom.com/share/${id}`,
      "apollographql-client-name": "loom-web",
      "x-loom-request-source": "loom_web/unknown",
    },
    body: JSON.stringify({
      operationName: "GetVideoSource",
      variables: { videoId: id },
      query: `query GetVideoSource($videoId: ID!) {
        getVideo(id: $videoId) {
          id
          source { raw download }
        }
      }`,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    data?: { getVideo?: { source?: { raw?: string; download?: string } } };
  } | null;
  const src = data?.data?.getVideo?.source;
  return src?.download ?? src?.raw ?? null;
}

async function resolveViaPageScrape(id: string): Promise<string | null> {
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
  return m ? m[0].replace(/^"url"\s*:\s*"/, "").replace(/\\u0026/g, "&") : null;
}

/** Resolve a Loom share URL to a downloadable MP4 URL, or null. */
export async function resolveLoomVideo(id: string): Promise<string | null> {
  return (
    (await resolveViaSessionsApi(id).catch(() => null)) ??
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
