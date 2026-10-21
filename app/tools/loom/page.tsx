"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const sel =
  "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#2962ff]";
const btn =
  "rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";

export default function LoomDownloaderPage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resolvedUrl, setResolvedUrl] = useState("");

  const valid = /loom\.com\/(share|embed|v)\/[0-9a-f]{32}/i.test(url);

  const download = async () => {
    setBusy(true);
    setErr("");
    setResolvedUrl("");
    try {
      // Resolve first so we can surface a friendly error before streaming.
      const res = await fetch(
        `/api/loom-download?raw=1&url=${encodeURIComponent(url)}`,
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error ?? "Could not resolve video");
        return;
      }
      setResolvedUrl(d.data.url);
      // Trigger the proxied download.
      const a = document.createElement("a");
      a.href = `/api/loom-download?url=${encodeURIComponent(url)}`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setErr("Download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#0b0e13] px-4 pt-16 text-neutral-200">
      <div className="w-full max-w-lg rounded-xl border border-[#2a2e39] bg-[#131722] p-6 shadow-2xl">
        <h1 className="text-lg font-bold text-white">Loom Video Downloader</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Paste a public Loom share link to download the MP4. Private or
          password-protected videos can&apos;t be fetched — Loom requires login for
          those.
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
              {busy ? "Resolving…" : "Download MP4"}
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
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>

        <p className="mt-4 border-t border-[#2a2e39] pt-3 text-[10px] text-neutral-600">
          Downloading works only for videos shared publicly on Loom. Respect the
          video owner&apos;s rights.
        </p>
      </div>
    </div>
  );
}
