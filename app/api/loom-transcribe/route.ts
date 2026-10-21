import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractLoomVideoId, loomVideoTitle, resolveLoomVideo } from "@/lib/loom";

/**
 * Loom → Whisper → Markdown transcription.
 *
 * GET /api/loom-transcribe?url=<loom share url>
 *   → streams a .md file with the timestamped transcript
 * GET /api/loom-transcribe?url=<loom share url>&raw=1
 *   → { data: { markdown, title } } — JSON instead of a file download
 *
 * Requires OPENAI_API_KEY. Whisper accepts up to 25 MB per request —
 * longer Looms in mp4 form typically compress well under that.
 */
export const maxDuration = 300;

const querySchema = z.object({
  url: z.string().url().max(2000),
  raw: z.coerce.boolean().optional(),
});

const WHISPER_LIMIT = 25 * 1024 * 1024; // 25 MB

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

function fmtTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function toMarkdown(
  title: string | null,
  shareUrl: string,
  id: string,
  text: string,
  segments: WhisperSegment[] | undefined,
): string {
  const lines: string[] = [
    `# ${title ?? `Loom video ${id}`}`,
    "",
    `> Source: ${shareUrl}`,
    `> Transcribed: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    "## Transcript",
    "",
  ];
  if (segments?.length) {
    for (const seg of segments) {
      lines.push(`**[${fmtTimestamp(seg.start)}]** ${seg.text.trim()}`, "");
    }
  } else {
    lines.push(text, "");
  }
  return lines.join("\n");
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

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const id = extractLoomVideoId(parsed.data.url);
  if (!id) {
    return NextResponse.json(
      { error: "Not a Loom video URL — expected loom.com/share/<id>" },
      { status: 400 },
    );
  }

  const videoUrl = await resolveLoomVideo(id);
  if (!videoUrl) {
    return NextResponse.json(
      {
        error:
          "Could not resolve a downloadable MP4 — the video may be private, password-protected, or deleted.",
      },
      { status: 404 },
    );
  }

  // Download the mp4 into memory, enforcing Whisper's size limit.
  const videoRes = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!videoRes.ok || !videoRes.body) {
    return NextResponse.json(
      { error: `Loom CDN returned ${videoRes.status}` },
      { status: 502 },
    );
  }
  const declaredLen = Number(videoRes.headers.get("content-length") ?? 0);
  if (declaredLen > WHISPER_LIMIT) {
    return NextResponse.json(
      { error: "Video is over Whisper's 25 MB limit — download the MP4 and transcribe locally" },
      { status: 413 },
    );
  }
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());
  if (videoBuf.byteLength > WHISPER_LIMIT) {
    return NextResponse.json(
      { error: "Video is over Whisper's 25 MB limit — download the MP4 and transcribe locally" },
      { status: 413 },
    );
  }

  // Send to Whisper with segment timestamps.
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(videoBuf)], { type: "video/mp4" }),
    `loom-${id}.mp4`,
  );
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!whisperRes.ok) {
    const detail = await whisperRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Whisper transcription failed (${whisperRes.status})`, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  const transcript = (await whisperRes.json()) as {
    text?: string;
    segments?: WhisperSegment[];
  };

  const title = await loomVideoTitle(id).catch(() => null);
  const markdown = toMarkdown(
    title,
    parsed.data.url,
    id,
    transcript.text ?? "",
    transcript.segments,
  );

  if (parsed.data.raw) {
    return NextResponse.json({ data: { markdown, title, id } });
  }

  const filename = `${(title ?? `loom-${id}`).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || `loom-${id}`}.md`;
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
