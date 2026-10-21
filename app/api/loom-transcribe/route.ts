import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractLoomVideoId, loomVideoTitle, resolveLoomVideo } from "@/lib/loom";
import { hlsAudioToMp3 } from "@/lib/loom-hls";
import { createProgressStream, NDJSON_HEADERS, sendFile } from "@/lib/progress-stream";

const execFileAsync = promisify(execFile);

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
  progress: z.coerce.boolean().optional(),
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

// ── Whisper (audio extraction + chunking, 25 MB cap per chunk) ───────────────

/** Call Whisper on one audio file; returns text + timestamped segments. */
async function whisperOnce(
  buf: Buffer,
  filename: string,
  mime: string,
): Promise<{ text: string; segments?: Segment[] }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json() as Promise<{ text: string; segments?: Segment[] }>;
}

/** Run ffmpeg; resolves on exit 0, rejects with stderr tail otherwise. */
async function ffmpeg(args: string[]): Promise<void> {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) throw new Error("ffmpeg binary not available on this platform");
  try {
    await execFileAsync(ffmpegPath, args, { maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`ffmpeg failed: ${(err.stderr ?? err.message).slice(-300)}`);
  }
}

/** Parse "Duration: HH:MM:SS.xx" from ffmpeg -i stderr output. */
async function mediaDurationSec(file: string): Promise<number> {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) return 0;
  try {
    await execFileAsync(ffmpegPath, ["-i", file]);
    return 0;
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr ?? "";
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  }
}

/**
 * Transcribe a local mp3 with Whisper, chunking into ~20-minute segments
 * when the file exceeds the 25 MB cap. Segment timestamps are offset back
 * to absolute positions so the merged transcript reads continuously.
 */
async function whisperChunked(
  mp3Path: string,
  dir: string,
  id: string,
  onStep?: (msg: string) => void,
): Promise<TranscriptResult> {
  const mp3Size = (await stat(mp3Path)).size;
  if (mp3Size === 0) throw new Error("Audio extraction produced an empty file — video may have no audio track");

  if (mp3Size <= WHISPER_LIMIT) {
    onStep?.(`Sending ${(mp3Size / 1024 / 1024).toFixed(1)} MB audio to Whisper…`);
    const r = await whisperOnce(await readFile(mp3Path), `loom-${id}.mp3`, "audio/mpeg");
    return { text: r.text ?? "", segments: r.segments, engine: "whisper" };
  }

  const duration = await mediaDurationSec(mp3Path);
  if (duration <= 0) {
    throw Object.assign(
      new Error("Extracted audio exceeds 25 MB and duration could not be probed — set DEEPGRAM_API_KEY for unlimited URL transcription"),
      { status: 413 },
    );
  }
  const CHUNK_SEC = 1200; // ~2.4 MB per chunk at 32 kbps
  const chunks = Math.ceil(duration / CHUNK_SEC);
  const texts: string[] = [];
  const segments: Segment[] = [];

  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SEC;
    const len = Math.min(CHUNK_SEC, duration - start);
    const chunkPath = join(dir, `chunk-${i}.mp3`);
    await ffmpeg(["-y", "-ss", String(start), "-t", String(len), "-i", mp3Path, "-c", "copy", chunkPath]);

    const size = (await stat(chunkPath)).size;
    if (size > WHISPER_LIMIT) {
      throw Object.assign(
        new Error(`Audio chunk ${i + 1}/${chunks} still exceeds 25 MB — set DEEPGRAM_API_KEY for unlimited URL transcription`),
        { status: 413 },
      );
    }
    if (size === 0) continue;

    onStep?.(`Transcribing chunk ${i + 1}/${chunks} (${fmtTimestamp(start)}–${fmtTimestamp(start + len)})…`);
    const r = await whisperOnce(await readFile(chunkPath), `loom-${id}-part${i + 1}.mp3`, "audio/mpeg");
    if (r.text) texts.push(r.text.trim());
    for (const s of r.segments ?? []) {
      segments.push({ start: s.start + start, text: s.text });
    }
  }

  return { text: texts.join(" "), segments, engine: "whisper" };
}

/**
 * Download → extract audio → transcribe. If the compressed audio still exceeds
 * Whisper's 25 MB cap, split it into ~20-minute chunks, transcribe each with
 * offset timestamps, and stitch the results into a single transcript.
 */
async function transcribeWhisper(
  videoUrl: string,
  id: string,
  onStep?: (msg: string) => void,
): Promise<TranscriptResult> {
  onStep?.("Downloading video from Loom CDN…");
  const videoRes = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!videoRes.ok || !videoRes.body) {
    throw new Error(`Loom CDN returned ${videoRes.status}`);
  }

  const dir = await mkdtemp(join(tmpdir(), "loom-"));
  try {
    const mp4Path = join(dir, `${id}.mp4`);
    const mp3Path = join(dir, `${id}.mp3`);
    await writeFile(mp4Path, Buffer.from(await videoRes.arrayBuffer()));

    // Extract mono 16 kHz mp3 — speech needs nothing more; ~0.12 MB/min.
    // A 25 MB video typically yields 2–4 MB of audio, avoiding any chunking.
    onStep?.("Extracting audio track (16 kHz mono mp3)…");
    await ffmpeg([
      "-y", "-i", mp4Path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", mp3Path,
    ]);

    return await whisperChunked(mp3Path, dir, id, onStep);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * HLS variant: pull just the audio stream's playlist (signature-propagated)
 * and encode straight to mp3 — the video track never gets downloaded.
 */
async function transcribeWhisperHls(
  masterUrl: string,
  id: string,
  onStep?: (msg: string) => void,
): Promise<TranscriptResult> {
  const { dir, file } = await hlsAudioToMp3(masterUrl, onStep);
  try {
    return await whisperChunked(file, dir, `${id}-hls`, onStep);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({
    url: req.nextUrl.searchParams.get("url"),
    raw: req.nextUrl.searchParams.get("raw") ?? undefined,
    progress: req.nextUrl.searchParams.get("progress") ?? undefined,
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

  // ── Progress mode: NDJSON event stream ──────────────────────────────────
  if (parsed.data.progress) {
    const p = createProgressStream();
    (async () => {
      try {
        p.step("resolve", "Resolving Loom video");
        const video = await resolveLoomVideo(id);
        if (!video) {
          p.fail(
            "resolve",
            "Could not resolve a downloadable MP4 — the video may be private, password-protected, or deleted.",
          );
          return;
        }
        p.done("resolve", video.kind === "hls" ? "HLS stream" : "Direct MP4");

        p.step("transcribe", useDeepgram ? "Transcribing via Deepgram" : "Transcribing via Whisper");
        const onStep = (msg: string) => p.step("transcribe", msg);
        let result: TranscriptResult;
        try {
          result = useDeepgram
            ? await transcribeDeepgram(video.url)
            : video.kind === "hls"
              ? await transcribeWhisperHls(video.url, id, onStep)
              : await transcribeWhisper(video.url, id, onStep);
        } catch (first) {
          if (useDeepgram && useWhisper) {
            p.step("transcribe", "Deepgram failed — falling back to Whisper");
            result = video.kind === "hls"
              ? await transcribeWhisperHls(video.url, id, onStep)
              : await transcribeWhisper(video.url, id, onStep);
          } else {
            throw first;
          }
        }
        p.done("transcribe", `${result.engine} · ${result.segments?.length ?? 0} segments`);

        p.step("markdown", "Building markdown");
        const title = video.title ?? (await loomVideoTitle(id).catch(() => null));
        const markdown = toMarkdown(title, parsed.data.url, id, result);
        const filename = `${(title ?? `loom-${id}`).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || `loom-${id}`}.md`;
        p.done("markdown", filename);

        sendFile(p.send, Buffer.from(markdown, "utf8"), filename, "text/markdown");
        p.send({ type: "done" });
      } catch (e) {
        p.fail("transcribe", e instanceof Error ? e.message : "Transcription failed");
      } finally {
        p.close();
      }
    })();
    return new NextResponse(p.stream, { headers: NDJSON_HEADERS });
  }

  // ── Plain mode ──────────────────────────────────────────────────────────
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
    try {
      result = useDeepgram
        ? await transcribeDeepgram(video.url)
        : video.kind === "hls"
          ? await transcribeWhisperHls(video.url, id)
          : await transcribeWhisper(video.url, id);
    } catch (first) {
      // Deepgram can't ingest HLS playlists — fall back to Whisper's local
      // audio extraction when both keys are configured.
      if (useDeepgram && useWhisper) {
        result = video.kind === "hls"
          ? await transcribeWhisperHls(video.url, id)
          : await transcribeWhisper(video.url, id);
      } else {
        throw first;
      }
    }
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
