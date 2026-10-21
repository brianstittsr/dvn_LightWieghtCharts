"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#2962ff]";
const btn =
  "rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";

const CONCURRENCY = 3;
const URL_RE = /loom\.com\/(share|embed|v)\/[0-9a-f]{32}/i;

interface Step {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
}

interface ProgressEvent {
  type: "step" | "file" | "chunk" | "done" | "error";
  step?: string;
  label?: string;
  detail?: string;
  status?: "running" | "done" | "error";
  filename?: string;
  mime?: string;
  total?: number;
  data?: string;
  error?: string;
}

type JobKind = "mp4" | "md";

interface Job {
  id: number;
  url: string;
  videoId: string;
  kind: JobKind;
  status: "queued" | "running" | "done" | "error";
  steps: Step[];
  error?: string;
  filename?: string;
  markdown?: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function statusIcon(status: Job["status"] | Step["status"]) {
  if (status === "running")
    return (
      <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[#2962ff] border-t-transparent" />
    );
  if (status === "done")
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
        ✓
      </span>
    );
  if (status === "error")
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
        ✕
      </span>
    );
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-600 text-[9px] text-neutral-500">
      …
    </span>
  );
}

export default function LoomDownloaderPage() {
  const [input, setInput] = useState("");
  const [queue, setQueue] = useState<Job[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const nextId = useRef(1);

  const urls = input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const validUrls = urls.filter((u) => URL_RE.test(u));

  const patchJob = (id: number, patch: Partial<Job>) =>
    setQueue((q) => q.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const pushStep = (id: number, e: ProgressEvent) =>
    setQueue((q) =>
      q.map((j) => {
        if (j.id !== id) return j;
        const i = j.steps.findIndex((s) => s.id === e.step);
        const next: Step = {
          id: e.step ?? "?",
          label: e.label ?? (i >= 0 ? j.steps[i].label : "?"),
          detail: e.detail,
          status: e.status ?? "running",
        };
        if (i < 0) return { ...j, steps: [...j.steps, next] };
        const steps = [...j.steps];
        steps[i] = { ...steps[i], ...next };
        return { ...j, steps };
      }),
    );

  const enqueue = (kind: JobKind) => {
    const jobs: Job[] = validUrls.map((url) => ({
      id: nextId.current++,
      url,
      videoId: url.match(/[0-9a-f]{32}/i)?.[0]?.toLowerCase() ?? url,
      kind,
      status: "queued",
      steps: [],
    }));
    setQueue((q) => [...q, ...jobs]);
  };

  /** Run one job: consume its NDJSON stream, save the file, update state. */
  const runJob = async (job: Job) => {
    patchJob(job.id, { status: "running" });
    const endpoint =
      job.kind === "mp4"
        ? `/api/loom-download?progress=1&url=${encodeURIComponent(job.url)}`
        : `/api/loom-transcribe?progress=1&url=${encodeURIComponent(job.url)}`;

    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let filename = "download";
      let mime = "application/octet-stream";
      const chunks: Uint8Array[] = [];

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as ProgressEvent;
          if (e.type === "step") pushStep(job.id, e);
          else if (e.type === "file") {
            filename = e.filename ?? filename;
            mime = e.mime ?? mime;
            patchJob(job.id, { filename });
          } else if (e.type === "chunk" && e.data) {
            chunks.push(b64ToBytes(e.data));
          } else if (e.type === "error") {
            throw new Error(e.error ?? "Unknown error");
          }
        }
      }

      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      const blob = new Blob([out.buffer as ArrayBuffer], { type: mime });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);

      patchJob(job.id, {
        status: "done",
        markdown:
          mime === "text/markdown" ? new TextDecoder().decode(out) : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setQueue((q) =>
        q.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: "error",
                error: msg,
                steps: j.steps.length
                  ? j.steps.map((s, i) =>
                      i === j.steps.length - 1 && s.status === "running"
                        ? { ...s, status: "error" }
                        : s,
                    )
                  : [{ id: "error", label: msg, status: "error" }],
              }
            : j,
        ),
      );
    }
  };

  // Scheduler: keep up to CONCURRENCY jobs running.
  const inFlight = useRef(new Set<number>());
  useEffect(() => {
    for (const job of queue) {
      if (inFlight.current.size >= CONCURRENCY) break;
      if (job.status === "queued" && !inFlight.current.has(job.id)) {
        inFlight.current.add(job.id);
        void runJob(job).finally(() => inFlight.current.delete(job.id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Duplicates: same video queued for the same job type more than once.
  const dupKeys = new Map<string, number>();
  for (const j of queue) {
    const k = `${j.videoId}:${j.kind}`;
    dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1);
  }
  const isDup = (j: Job) => (dupKeys.get(`${j.videoId}:${j.kind}`) ?? 0) > 1;
  const dupCount = queue.filter(isDup).length;

  const removeJob = (id: number) =>
    setQueue((q) => q.filter((j) => j.id !== id || j.status === "running"));

  const running = queue.filter((j) => j.status === "running").length;
  const queued = queue.filter((j) => j.status === "queued").length;
  const doneCount = queue.filter((j) => j.status === "done").length;
  const errCount = queue.filter((j) => j.status === "error").length;

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#0b0e13] px-4 pt-16 text-neutral-200">
      <div className="w-full max-w-2xl rounded-xl border border-[#2a2e39] bg-[#131722] p-6 shadow-2xl">
        <h1 className="text-lg font-bold text-white">Loom Video Downloader</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Paste public Loom share links — one per line — then queue MP4
          downloads or timestamped markdown transcripts. Up to {CONCURRENCY}{" "}
          jobs run at once; the rest wait in line. Private or
          password-protected videos can&apos;t be fetched.
        </p>

        <div className="mt-4 space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"https://www.loom.com/share/1a2b3c…\nhttps://www.loom.com/share/4d5e6f…"}
            className={cn(sel, "h-20 resize-y font-mono text-xs")}
            aria-label="Loom share URLs, one per line"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => enqueue("mp4")}
              disabled={!validUrls.length}
              className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}
            >
              Queue MP4{validUrls.length > 1 ? `s (${validUrls.length})` : ""}
            </button>
            <button
              onClick={() => enqueue("md")}
              disabled={!validUrls.length}
              className={cn(btn, "bg-[#7a4bc4] hover:bg-[#8b5cd6]")}
            >
              Queue transcript
              {validUrls.length > 1 ? `s (${validUrls.length})` : ""}
            </button>
            {queue.length > 0 && (
              <button
                onClick={() => setQueue((q) => q.filter((j) => j.status === "queued" || j.status === "running"))}
                className="ml-auto rounded px-3 py-2 text-xs text-neutral-500 hover:text-white"
              >
                Clear finished
              </button>
            )}
          </div>

          {urls.length > 0 && validUrls.length < urls.length && (
            <p className="text-xs text-amber-400">
              {urls.length - validUrls.length} of {urls.length} link
              {urls.length > 1 ? "s" : ""} don&apos;t look like Loom share URLs
              and will be skipped.
            </p>
          )}
        </div>

        {/* Queue */}
        {queue.length > 0 && (
          <div className="mt-5 border-t border-[#2a2e39] pt-4">
            <p className="mb-3 text-xs text-neutral-500">
              {running > 0 && `${running} running · `}
              {queued > 0 && `${queued} queued · `}
              {doneCount > 0 && `${doneCount} done`}
              {errCount > 0 && ` · ${errCount} failed`}
              {dupCount > 0 && (
                <span className="text-amber-400"> · {dupCount} duplicate{dupCount > 1 ? "s" : ""}</span>
              )}
            </p>
            <ul className="space-y-2">
              {queue.map((j) => {
                const last = j.steps[j.steps.length - 1];
                const isExpanded = expanded === j.id;
                return (
                  <li
                    key={j.id}
                    className={cn(
                      "rounded-lg border bg-[#0b0e11] p-3",
                      isDup(j) ? "border-amber-600/50" : "border-[#2a2e39]",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0">
                        {statusIcon(j.status)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-white">
                          {j.filename ?? j.url}
                        </p>
                        <p className="text-[10px] text-neutral-500">
                          {j.kind === "mp4" ? "MP4 download" : "Transcript"}
                          {j.status === "queued" && " · waiting"}
                          {j.status === "running" && last && (
                            <>
                              {" · "}
                              {last.label}
                              {last.detail ? ` — ${last.detail}` : ""}
                            </>
                          )}
                          {j.status === "error" && (
                            <span className="text-red-400"> · {j.error}</span>
                          )}
                        </p>
                        {isDup(j) && (
                          <p className="mt-0.5 text-[10px] font-medium text-amber-400">
                            Duplicate — this video is already queued for{" "}
                            {j.kind === "mp4" ? "download" : "transcription"}
                          </p>
                        )}
                      </div>
                      {j.steps.length > 0 && (
                        <button
                          onClick={() =>
                            setExpanded(isExpanded ? null : j.id)
                          }
                          className="shrink-0 text-[10px] text-neutral-500 hover:text-white"
                        >
                          {isExpanded ? "Hide steps" : "Steps"}
                        </button>
                      )}
                      {j.markdown && (
                        <button
                          onClick={() =>
                            setPreview(preview === j.id ? null : j.id)
                          }
                          className="shrink-0 text-[10px] text-[#2962ff] hover:underline"
                        >
                          {preview === j.id ? "Hide" : "Preview"}
                        </button>
                      )}
                      {j.status !== "running" && (
                        <button
                          onClick={() => removeJob(j.id)}
                          className="shrink-0 text-[10px] text-neutral-500 hover:text-red-400"
                          aria-label="Remove from queue"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {isExpanded && (
                      <ul className="mt-2 space-y-1.5 border-t border-[#2a2e39] pt-2">
                        {j.steps.map((s) => (
                          <li
                            key={s.id}
                            className="flex items-start gap-2"
                          >
                            <span className="mt-0.5 shrink-0">
                              {statusIcon(s.status)}
                            </span>
                            <div className="min-w-0">
                              <p
                                className={cn(
                                  "text-[11px]",
                                  s.status === "error"
                                    ? "text-red-400"
                                    : s.status === "done"
                                      ? "text-neutral-400"
                                      : "text-white",
                                )}
                              >
                                {s.label}
                              </p>
                              {s.detail && (
                                <p className="text-[10px] text-neutral-500">
                                  {s.detail}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {preview === j.id && j.markdown && (
                      <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-[#2a2e39] bg-[#131722] p-2 text-[10px] text-neutral-300">
                        {j.markdown}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="mt-4 border-t border-[#2a2e39] pt-3 text-[10px] text-neutral-600">
          Downloading works only for videos shared publicly on Loom.
          Transcription uses Deepgram (no size limit, DEEPGRAM_API_KEY) or
          OpenAI Whisper (audio extracted + chunked locally, OPENAI_API_KEY).
          Respect the video owner&apos;s rights.
        </p>
      </div>
    </div>
  );
}
