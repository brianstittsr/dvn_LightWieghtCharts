import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * Loom video downloader.
 *
 * GET /api/loom-download?url=<loom share url>&raw=1
 *   → { data: { url, id } }           — resolve only, return the mp4 URL
 * GET /api/loom-download?url=<loom share url>
 *   → streams the mp4 with Content-Disposition: attachment
 *
 * Resolution tries, in order:
 *   1. Loom's sessions API (POST /api/campaigns/sessions/{id})
 *   2. Loom GraphQL GetVideoSource → signed CDN url
 *   3. Share-page HTML scrape for a cdn.loom.com mp4 link
 */
const querySchema = z.object({
  url: z.string().url().max(2000),
  raw: z.coerce.boolean().optional(),
});

/** Extract the 32-char video id from any Loom share/embed URL. */
function extractVideoId(url: string): string | null {
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
  // Look for a transcoded/raw mp4 CDN link embedded in the page JSON.
  const m =
    html.match(/https:\/\/cdn\.loom\.com\/sessions\/transcoded\/[^"\\]+\.mp4[^"\\]*/i) ??
    html.match(/"url"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/i);
  return m ? m[0].replace(/^"url"\s*:\s*"/, "").replace(/\\u0026/g, "&") : null;
}

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({
    url: req.nextUrl.searchParams.get("url"),
    raw: req.nextUrl.searchParams.get("raw") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid Loom share URL (?url=https://www.loom.com/share/…)" },
      { status: 400 },
    );
  }

  const id = extractVideoId(parsed.data.url);
  if (!id) {
    return NextResponse.json(
      { error: "Not a Loom video URL — expected loom.com/share/<id>" },
      { status: 400 },
    );
  }

  const videoUrl =
    (await resolveViaSessionsApi(id).catch(() => null)) ??
    (await resolveViaGraphql(id).catch(() => null)) ??
    (await resolveViaPageScrape(id).catch(() => null));

  if (!videoUrl) {
    return NextResponse.json(
      {
        error:
          "Could not resolve a downloadable MP4 — the video may be private, password-protected, or deleted.",
      },
      { status: 404 },
    );
  }

  if (parsed.data.raw) {
    return NextResponse.json({ data: { id, url: videoUrl } });
  }

  // Proxy the file so the browser downloads it with a sane filename.
  const upstream = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Loom CDN returned ${upstream.status}` },
      { status: 502 },
    );
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
    "Content-Disposition": `attachment; filename="loom-${id}.mp4"`,
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new NextResponse(upstream.body, { headers });
}
