import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({ prompt: z.string().min(3).max(2000) });

const SYSTEM_PROMPT = `You generate custom chart indicators for a trading dashboard.

Return ONLY a JSON object with this exact shape:
{
  "name": "Short indicator name",
  "params": [
    { "key": "length", "label": "Length", "type": "number", "default": 14, "min": 1, "max": 500, "step": 1 },
    { "key": "color", "label": "Color", "type": "color", "default": "#22d3ee" }
  ],
  "code": "<javascript function body>"
}

The code runs as: fn(candles, params, helpers) and must RETURN an array of series:
[{ "key": "main", "label": "My Line", "color": "#22d3ee", "values": [{ "time": <unix seconds>, "value": <number|null> }, ...] }]

Rules:
- candles: array of { time (unix seconds), open, high, low, close } — oldest first.
- params: object holding the user's configured param values (keys from "params").
- helpers: { sma(values: number[], period) => (number|null)[], ema(values, period) => (number|null)[] }
- values array MUST align index-for-index with candles (use null before the indicator is defined).
- Return 1-3 series (e.g. a band = upper/basis/lower series).
- No imports, no DOM, no fetch, no async. Pure computation only.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set — add it to .env.local and restart the dev server" },
      { status: 501 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: parsed.data.prompt },
        ],
        temperature: 0.3,
      }),
    });
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json({ error: body.error?.message ?? "OpenAI request failed" }, { status: 502 });
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) return NextResponse.json({ error: "Empty AI response" }, { status: 502 });

    const spec = JSON.parse(content) as { name: string; params: unknown[]; code: string };
    if (!spec.name || !spec.code || !Array.isArray(spec.params)) {
      return NextResponse.json({ error: "Malformed AI response" }, { status: 502 });
    }
    return NextResponse.json({ data: spec });
  } catch (err) {
    console.error("ai-indicator failed:", err);
    const isNetwork = err instanceof TypeError || (err instanceof Error && err.name === "TimeoutError");
    return NextResponse.json(
      {
        error: isNetwork
          ? "Cannot reach api.openai.com — check network/VPN/proxy and retry"
          : "Failed to generate indicator",
      },
      { status: 500 },
    );
  }
}
