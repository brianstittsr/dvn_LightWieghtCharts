import { readFile, rm } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractLoomVideoId, resolveLoomVideo } from "@/lib/loom";
import { downloadHlsToMp4 } from "@/lib/loom-hls";

/**
 * Loom video downloader.
 *
 * GET /api/loom-download?url=<loom share url>&raw=1
 *   → { data: { url, id } }           — resolve only, return the mp4 URL
 * GET /api/loom-download?url=<loom share url>
 *   → streams the mp4 with Content-Disposition: attachment
 */
const querySchema = z.object({
  url: z.string().url().max(2000),
  raw: z.coerce.boolean().optional(),
});

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

  const id = extractLoomVideoId(parsed.data.url);
  if (!id) {
    return NextResponse.json(
      { error: "Not a Loom video URL — expected loom.com/share/<id>" },
      { status: 400 },
    );
  }

  const video = await resolveLoomVideo(id);

  if (!video) {
    return NextResponse.json(
      {
        error:
          "Could not resolve a downloadable MP4 — the video may be private, password-protected, or deleted.",
      },
      { status: 404 },
    );
  }

  if (parsed.data.raw) {
    return NextResponse.json({ data: { id, url: video.url, title: video.title, kind: video.kind } });
  }

  // HLS-only video — download + remux to mp4 via ffmpeg, then stream.
  if (video.kind === "hls") {
    try {
      const { dir, file } = await downloadHlsToMp4(video.url);
      const buf = await readFile(file);
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="loom-${id}.mp4"`,
          "Content-Length": String(buf.byteLength),
        },
      });
    } catch (e) {
      return NextResponse.json(
        { error: `HLS download failed: ${e instanceof Error ? e.message : e}` },
        { status: 502 },
      );
    }
  }

  const upstream = await fetch(video.url, {
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
