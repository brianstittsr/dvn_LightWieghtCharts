import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractLoomVideoId, loomVideoTitle, resolveLoomVideo } from "@/lib/loom";

/**
 * Loom → transcript → Markdown.
 *
 * GET /api/loom-transcribe?url=<loom share url>
 *   → streams a .md file with the timestamped transcript
 * GET /api/loom-transcribe?url=<loom share url>&raw=1
 *   → { data: { markdown, title } } — JSON instead of a file download
 *
 * Backends (first configured wins):
 *  - DEEPGRAM_API_KEY → Deepgram nova-3, transcribes the CDN URL directly,
 *    no download and no size limit
 *  - OPENAI_API_KEY   → Whisper, 25 MB cap (video downloaded server-side)
 */
export const maxDuration = 300;

const querySchema = z.object({
  url: z.string().url().max(2000),
  raw: z.coerce.boolean().optional(),
});

const WHISPER_LIMIT = 25 * 1024 * 1024; // 25 MB

interface Segment {
  start: number;
  text: string;
}

interface TranscriptResult {
  text: string;
  segments?: Segment[];
  engine: "deepgram" | "whisper";
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
  result: TranscriptResult,
): string {
  const lines: string[] = [
    `# ${title ?? `Loom video ${id}`}`,
    "",
    `> Source: ${shareUrl}`,
    `> Transcribed: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${result.engine}`,
    "",
    "## Transcript",
    "",
  ];
  if (result.segments?.length) {
    for (const seg of result.segments) {
      lines.push(`**[${fmtTimestamp(seg.start)}]** ${seg.text.trim()}`, "");
    }
  } else {
    lines.push(result.text, "");
  }
  return lines.join("\n");
}

// ── Deepgram (URL-based, no size limit) ─────────────────────────────────────

async function transcribeDeepgram(videoUrl: string): Promise<TranscriptResult> {
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&paragraphs=true&utterances=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: videoUrl }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    results?: {
      channels?: {
        alternatives?: {
          transcript?: string;
          paragraphs?: {
            paragraphs?: { start: number; sentences?: { text: string }[] }[];
          };
          words?: { start: number; word: string }[];
        }[];
      }[];
    };
  };
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  const text = alt?.transcript ?? "";
  if (!text) throw new Error("Deepgram returned an empty transcript");

  const paragraphs = alt?.paragraphs?.paragraphs;
  const segments: Segment[] | undefined = paragraphs?.map((p) => ({
    start: p.start,
    text: (p.sentences ?? []).map((s) => s.text).join(" "),
  }));
  return { text, segments, engine: "deepgram" };
}

// ── Whisper (download + upload, 25 MB cap) ───────────────────────────────────

async function transcribeWhisper(videoUrl: string, id: string): Promise<TranscriptResult> {
  const videoRes = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!videoRes.ok || !videoRes.body) {
    throw new Error(`Loom CDN returned ${videoRes.status}`);
  }
  const declaredLen = Number(videoRes.headers.get("content-length") ?? 0);
  if (declaredLen > WHISPER_LIMIT) {
    throw Object.assign(
      new Error("Video is over Whisper's 25 MB limit — set DEEPGRAM_API_KEY for URL-based transcription with no size cap"),
      { status: 413 },
    );
  }
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());
  if (videoBuf.byteLength > WHISPER_LIMIT) {
    throw Object.assign(
      new Error("Video is over Whisper's 25 MB limit — set DEEPGRAM_API_KEY for URL-based transcription with no size cap"),
      { status: 413 },
    );
  }

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
    throw new Error(`Whisper ${whisperRes.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await whisperRes.json()) as {
    text?: string;
    segments?: Segment[];
  };
  return { text: data.text ?? "", segments: data.segments, engine: "whisper" };
}

// ── Route ────────────────────────────────────────────────────────────────────

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

  const useDeepgram = Boolean(process.env.DEEPGRAM_API_KEY);
  const useWhisper = Boolean(process.env.OPENAI_API_KEY);
  if (!useDeepgram && !useWhisper) {
    return NextResponse.json(
      { error: "No transcription backend configured — set DEEPGRAM_API_KEY (recommended, no size limit) or OPENAI_API_KEY (25 MB max)" },
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

  let result: TranscriptResult;
  try {
    result = useDeepgram
      ? await transcribeDeepgram(video.url)
      : await transcribeWhisper(video.url, id);
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status === 413 ? 413 : 502 },
    );
  }

  const title = video.title ?? (await loomVideoTitle(id).catch(() => null));
  const markdown = toMarkdown(title, parsed.data.url, id, result);

  if (parsed.data.raw) {
    return NextResponse.json({ data: { markdown, title, id, engine: result.engine } });
  }

  const filename = `${(title ?? `loom-${id}`).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || `loom-${id}`}.md`;
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
