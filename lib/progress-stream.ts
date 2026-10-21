/**
 * NDJSON progress streaming for long-running API routes.
 *
 * When a route is called with ?progress=1 it responds
 * `application/x-ndjson` and emits newline-delimited JSON events:
 *
 *   {"type":"step","step":"resolve","label":"Resolving video","status":"running"}
 *   {"type":"step","step":"resolve","status":"done"}
 *   {"type":"file","filename":"loom-x.mp4","mime":"video/mp4","total":12345}
 *   {"type":"chunk","data":"<base64>"}           — repeated
 *   {"type":"done"}
 *
 * On failure: {"type":"step","step":"<id>","status":"error"} +
 *             {"type":"error","error":"message"}
 */

export type StepStatus = "running" | "done" | "error";

export interface ProgressEvent {
  type: "step" | "file" | "chunk" | "done" | "error";
  step?: string;
  label?: string;
  detail?: string;
  status?: StepStatus;
  filename?: string;
  mime?: string;
  total?: number;
  data?: string;
  error?: string;
}

const encoder = new TextEncoder();

export function createProgressStream(): {
  stream: ReadableStream<Uint8Array>;
  send: (e: ProgressEvent) => void;
  step: (id: string, label: string, detail?: string) => void;
  done: (id: string, detail?: string) => void;
  fail: (id: string, msg: string) => void;
  close: () => void;
} {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const send = (e: ProgressEvent) => ctrl.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
  const step = (id: string, label: string, detail?: string) =>
    send({ type: "step", step: id, label, detail, status: "running" });
  const done = (id: string, detail?: string) =>
    send({ type: "step", step: id, status: "done", detail });
  const fail = (id: string, msg: string) => {
    send({ type: "step", step: id, status: "error" });
    send({ type: "error", error: msg });
  };
  const close = () => ctrl.close();
  return { stream, send, step, done, fail, close };
}

/** Emit a file as base64 chunks (~2 MB wire each) on the progress stream. */
export function sendFile(
  send: (e: ProgressEvent) => void,
  buf: Buffer,
  filename: string,
  mime: string,
): void {
  send({ type: "file", filename, mime, total: buf.byteLength });
  const CHUNK = 1_500_000; // raw bytes per event — ~2 MB base64
  for (let off = 0; off < buf.byteLength; off += CHUNK) {
    send({ type: "chunk", data: buf.subarray(off, off + CHUNK).toString("base64") });
  }
}

export const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no",
} as const;
