"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#2962ff]";
const btn =
  "rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";

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

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function LoomDownloaderPage() {
  const [url, setUrl] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState("");
  const [resolvedUrl, setResolvedUrl] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [finished, setFinished] = useState(false);

  const valid = /loom\.com\/(share|embed|v)\/[0-9a-f]{32}/i.test(url);

  /** Consume an NDJSON progress stream; update steps; collect file chunks. */
  const runWithProgress = async (
    endpoint: string,
    title: string,
    onMarkdown?: (md: string) => void,
  ) => {
    setErr("");
    setMarkdown("");
    setResolvedUrl("");
    setModalTitle(title);
    setSteps([]);
    setFinished(false);
    setModalOpen(true);

    const pushStep = (e: ProgressEvent) => {
      setSteps((prev) => {
        const i = prev.findIndex((s) => s.id === e.step);
        const next: Step = {
          id: e.step ?? "?",
          label: e.label ?? (i >= 0 ? prev[i].label : "?"),
          detail: e.detail,
          status: e.status ?? "running",
        };
        if (i < 0) return [...prev, next];
        const copy = [...prev];
        copy[i] = { ...copy[i], ...next };
        return copy;
      });
    };

    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let filename = "";
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
          if (e.type === "step") pushStep(e);
          else if (e.type === "file") {
            filename = e.filename ?? "download";
            mime = e.mime ?? mime;
          } else if (e.type === "chunk" && e.data) {
            chunks.push(b64ToBytes(e.data));
          } else if (e.type === "error") {
            throw new Error(e.error ?? "Unknown error");
          }
        }
      }

      // Assemble + save.
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

      if (mime === "text/markdown") {
        const text = new TextDecoder().decode(out);
        setMarkdown(text);
        onMarkdown?.(text);
      }
      setFinished(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setErr(msg);
      setSteps((prev) =>
        prev.length
          ? prev.map((s, i) =>
              i === prev.length - 1 && s.status === "running"
                ? { ...s, status: "error" }
                : s,
            )
          : [{ id: "error", label: msg, status: "error" }],
      );
    }
  };

  const download = () =>
    runWithProgress(
      `/api/loom-download?progress=1&url=${encodeURIComponent(url)}`,
      "Downloading video",
    );

  const transcribe = () =>
    runWithProgress(
      `/api/loom-transcribe?progress=1&url=${encodeURIComponent(url)}`,
      "Transcribing video",
    );

  const busy = modalOpen && !finished && !err;

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#0b0e13] px-4 pt-16 text-neutral-200">
      <div className="w-full max-w-lg rounded-xl border border-[#2a2e39] bg-[#131722] p-6 shadow-2xl">
        <h1 className="text-lg font-bold text-white">Loom Video Downloader</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Paste a public Loom share link to download the MP4 or a timestamped
          markdown transcript. Private or password-protected videos can&apos;t be
          fetched — Loom requires login for those.
        </p>

        <div className="mt-4 space-y-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.loom.com/share/1a2b3c…"
            className={sel}
            aria-label="Loom share URL"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={download}
              disabled={busy || !valid}
              className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}
            >
              Download MP4
            </button>
            <button
              onClick={transcribe}
              disabled={busy || !valid}
              className={cn(btn, "bg-[#7a4bc4] hover:bg-[#8b5cd6]")}
            >
              Transcribe → .md
            </button>
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#2962ff] hover:underline"
              >
                Open direct CDN link
              </a>
            )}
          </div>

          {url && !valid && (
            <p className="text-xs text-amber-400">
              That doesn&apos;t look like a Loom share URL.
            </p>
          )}

          {markdown && (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-[#2a2e39] bg-[#0b0e11] p-3 text-[11px] text-neutral-300">
              {markdown}
            </pre>
          )}
        </div>

        <p className="mt-4 border-t border-[#2a2e39] pt-3 text-[10px] text-neutral-600">
          Downloading works only for videos shared publicly on Loom. Transcription
          uses Deepgram (no size limit, DEEPGRAM_API_KEY) or OpenAI Whisper
          (audio extracted + chunked locally, OPENAI_API_KEY). Respect the video
          owner&apos;s rights.
        </p>
      </div>

      {/* Progress modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div
            className="w-full max-w-md rounded-xl border border-[#2a2e39] bg-[#131722] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">{modalTitle}</h2>
              {(finished || err) && (
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-gray-500 hover:text-white"
                  aria-label="Close"
                >
                  ✕
                </button>
              )}
            </div>

            <ul className="space-y-2">
              {steps.map((s) => (
                <li key={s.id} className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-block h-4 w-4 shrink-0">
                    {s.status === "running" ? (
                      <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[#2962ff] border-t-transparent" />
                    ) : s.status === "done" ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                        ✓
                      </span>
                    ) : (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                        ✕
                      </span>
                    )}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-xs font-medium",
                        s.status === "done"
                          ? "text-neutral-400"
                          : s.status === "error"
                            ? "text-red-400"
                            : "text-white",
                      )}
                    >
                      {s.label}
                    </p>
                    {s.detail && (
                      <p className="text-[10px] text-neutral-500">{s.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {err && <p className="mt-3 text-xs text-red-400">{err}</p>}
            {finished && (
              <p className="mt-3 text-xs text-emerald-400">
                Complete — your download should have started.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
