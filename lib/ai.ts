/**
 * Local-model client for LM Studio's OpenAI-compatible API (Fin-R1 and friends).
 *
 * Fin-R1 is a finance-reasoning model — we use it for analysis tasks
 * (optimizer result reasoning, news catalyst summaries), not code
 * generation. LM Studio serves chat completions at
 * `POST {LMSTUDIO_BASE_URL}/chat/completions` (default http://localhost:1234/v1).
 */

const BASE_URL = (process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1").replace(/\/$/, "");
const MODEL = process.env.LMSTUDIO_MODEL ?? "fin-r1";

export interface FinChatOptions {
  system: string;
  user: string;
  /** When true, ask for JSON and extract the first {...} block tolerantly. */
  json?: boolean;
  /** Sampling temperature — low for structured tasks. */
  temperature?: number;
  timeoutMs?: number;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatCompletion {
  choices?: {
    message?: {
      content?: string;
      /** LM Studio surfaces reasoning-model traces here for some models. */
      reasoning_content?: string;
    };
  }[];
}

/** Strip <think>…</think> reasoning blocks some models embed in content. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Extract the first balanced {...} JSON object from model text. */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export class FinUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinUnavailableError";
  }
}

/**
 * Send a chat completion to the local model. Throws FinUnavailableError when
 * LM Studio is unreachable so callers can fall back (e.g. to OpenAI).
 */
export async function finChat(opts: FinChatOptions): Promise<{ content: string; model: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: opts.json
          ? [
              ...messages,
              {
                role: "system",
                content: "Respond with ONLY a valid JSON object — no markdown fences, no prose.",
              },
            ]
          : messages,
        temperature: opts.temperature ?? 0.2,
        // LM Studio rejects response_format:"json_object" (wants json_schema);
        // a plain instruction + tolerant extraction is more portable.
      }),
    });
  } catch {
    throw new FinUnavailableError(
      `LM Studio unreachable at ${BASE_URL} — start LM Studio and load the model`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LM Studio ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as ChatCompletion;
  const msg = data.choices?.[0]?.message;
  const raw = msg?.content ?? "";
  const content = stripThink(raw);
  return { content, model: MODEL };
}

/** Whether the local model server is up (and which models are loaded). */
export async function finAvailable(): Promise<{ ok: boolean; models: string[] }> {
  try {
    const res = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return { ok: false, models: [] };
    const data = (await res.json()) as { data?: { id?: string }[] };
    return { ok: true, models: (data.data ?? []).map((m) => m.id ?? "").filter(Boolean) };
  } catch {
    return { ok: false, models: [] };
  }
}

export const FIN_MODEL_NAME = MODEL;
export const FIN_BASE_URL = BASE_URL;
