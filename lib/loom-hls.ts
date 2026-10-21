/**
 * HLS download/remux for Loom videos that have no transcoded MP4.
 *
 * Loom signs the master playlist URL with CloudFront params scoped to
 * `resource/*`, so the same Policy/Signature/Key-Pair-Id query must be
 * propagated to every sub-playlist and segment URI. Playlists are rewritten
 * locally with absolute signed URLs, then ffmpeg muxes them.
 *
 * Server-only — requires ffmpeg-static and node:fs.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function ffmpegBin(): Promise<string> {
  const p = (await import("ffmpeg-static")).default;
  if (!p) throw new Error("ffmpeg binary not available on this platform");
  return p;
}

/** Fetch a playlist and rewrite every URI (segments + URI="…" attrs) absolute+signed. */
async function fetchRewrittenPlaylist(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Playlist fetch failed (${res.status})`);
  const text = await res.text();
  const qi = url.indexOf("?");
  const query = qi >= 0 ? url.slice(qi) : "";
  const base = url.slice(0, url.lastIndexOf("/") + 1);

  const sign = (uri: string) => {
    const abs = uri.startsWith("http") ? uri : base + uri;
    if (!query || abs.includes("Policy=") || abs.includes("Signature=")) return abs;
    // URIs can already carry their own query — join with &, not a second ?
    return abs + (abs.includes("?") ? "&" + query.slice(1) : query);
  };

  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      // URI="..." attributes on #EXT-X-* tags
      if (t.startsWith("#") && t.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/, (_m, uri: string) => `URI="${sign(uri)}"`);
      }
      // Bare URI lines (segment or sub-playlist)
      if (!t.startsWith("#")) return sign(t);
      return line;
    })
    .join("\n");
}

/** Pick the audio playlist URI and the highest-bandwidth video playlist URI. */
export function parseMasterPlaylist(text: string): {
  audioUri: string | null;
  bestVideoUri: string | null;
} {
  const lines = text.split("\n").map((l) => l.trim());
  let audioUri: string | null = null;
  let bestVideoUri: string | null = null;
  let bestBw = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/.test(l)) {
      audioUri = l.match(/URI="([^"]+)"/)?.[1] ?? null;
    }
    if (l.startsWith("#EXT-X-STREAM-INF")) {
      const bw = Number(l.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
      const next = lines[i + 1];
      if (bw > bestBw && next && !next.startsWith("#")) {
        bestBw = bw;
        bestVideoUri = next;
      }
    }
  }
  return { audioUri, bestVideoUri };
}

function resolveUri(uri: string, playlistUrl: string): string {
  const base = playlistUrl.slice(0, playlistUrl.lastIndexOf("/") + 1);
  const query = playlistUrl.slice(playlistUrl.indexOf("?"));
  const abs = uri.startsWith("http") ? uri : base + uri;
  return abs.includes("?") ? abs + "&" + query.slice(1) : abs + query;
}

async function runFfmpeg(args: string[]): Promise<void> {
  const bin = await ffmpegBin();
  try {
    await execFileAsync(bin, args, { maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`ffmpeg failed: ${(err.stderr ?? err.message).slice(-300)}`);
  }
}

const WHITELIST = ["-protocol_whitelist", "file,https,tls,tcp,crypto,data"];

/**
 * Download an HLS stream to a local MP4 (highest-bandwidth video + audio,
 * stream-copied — no re-encode). Returns the temp dir + file path; caller
 * is responsible for rm'ing the dir.
 */
export async function downloadHlsToMp4(
  masterUrl: string,
  onStep?: (msg: string) => void,
): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "loom-hls-"));
  try {
    onStep?.("Fetching master playlist…");
    const masterText = await (await fetch(masterUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    }).then((r) => {
      if (!r.ok) throw new Error(`Master playlist ${r.status}`);
      return r.text();
    })) as string;

    const { audioUri, bestVideoUri } = parseMasterPlaylist(masterText);
    if (!bestVideoUri) throw new Error("No video stream found in HLS playlist");

    // Rewrite sub-playlists with signed segment URLs.
    onStep?.("Fetching video segments playlist…");
    const vidText = await fetchRewrittenPlaylist(resolveUri(bestVideoUri, masterUrl));
    const vidPath = join(dir, "video.m3u8");
    await writeFile(vidPath, vidText);
    const vidSegs = vidText.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;

    let audPath: string | null = null;
    let audSegs = 0;
    if (audioUri) {
      onStep?.("Fetching audio segments playlist…");
      const audText = await fetchRewrittenPlaylist(resolveUri(audioUri, masterUrl));
      audPath = join(dir, "audio.m3u8");
      await writeFile(audPath, audText);
      audSegs = audText.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
    }

    onStep?.(
      `Downloading & remuxing ${vidSegs + audSegs} segments to mp4…`,
    );
    const out = join(dir, "video.mp4");
    // -protocol_whitelist is per-input — repeat before EVERY -i or the
    // second playlist's https segments get blocked by the default
    // file,crypto whitelist.
    const args = [...WHITELIST, "-y", "-i", vidPath];
    if (audPath) args.push(...WHITELIST, "-i", audPath);
    args.push("-c", "copy", "-bsf:a", "aac_adtstoasc", out);
    await runFfmpeg(args);

    return { dir, file: out };
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Extract audio from an HLS stream into a local mp3. Uses the dedicated
 * audio playlist when present, else the best video playlist's audio.
 */
export async function hlsAudioToMp3(
  masterUrl: string,
  onStep?: (msg: string) => void,
): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "loom-hls-"));
  try {
    onStep?.("Fetching master playlist…");
    const masterText = await (await fetch(masterUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    }).then((r) => {
      if (!r.ok) throw new Error(`Master playlist ${r.status}`);
      return r.text();
    })) as string;

    const { audioUri, bestVideoUri } = parseMasterPlaylist(masterText);
    const pick = audioUri ?? bestVideoUri;
    if (!pick) throw new Error("No audio or video stream found in HLS playlist");

    onStep?.("Fetching audio segments playlist…");
    const plText = await fetchRewrittenPlaylist(resolveUri(pick, masterUrl));
    const plPath = join(dir, "audio.m3u8");
    await writeFile(plPath, plText);
    const segs = plText.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;

    onStep?.(`Downloading ${segs} audio segments → mp3…`);
    const out = join(dir, "audio.mp3");
    await runFfmpeg([
      ...WHITELIST, "-y", "-i", plPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", out,
    ]);

    return { dir, file: out };
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}
