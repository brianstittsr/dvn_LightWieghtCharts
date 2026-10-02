import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  prompt: z.string().min(3).max(2000),
  answers: z.array(z.string().max(1000)).max(8).optional(),
});

const SYSTEM_PROMPT = `You generate backtest strategy code for a trading dashboard.

FIRST, decide whether the user's request is specific enough to produce runnable
strategy code. A runnable strategy needs: clear entry conditions, clear exit
conditions, and a direction (long, short, or both). If any of these are missing
or ambiguous, return ONLY a JSON object asking 1-4 concise follow-up questions:
{ "questions": ["What triggers the entry?", "When should the position exit?", ...] }

Only ask what is genuinely needed — vague parameter values are fine to choose
sensible defaults for (expose them as params instead of asking). If the request
is already runnable, or the user's message includes "Answers:" lines responding
to earlier questions, incorporate them and return the spec directly.

When generating, return ONLY a JSON object with this exact shape:
{
  "name": "Short strategy name",
  "description": "One-sentence description",
  "params": [
    { "key": "length", "label": "Length", "type": "number", "default": 14, "min": 1, "max": 500, "step": 1 }
  ],
  "code": "<javascript function body>"
}

The code runs as: fn(candles, params, helpers) and must RETURN an array of desired
positions — one string per candle: "long", "short", or "flat".
The engine enters/exits at the NEXT bar's open, so never look ahead.

Rules:
- candles: array of { time (unix seconds), open, high, low, close, volume? } — oldest first.
- params: object holding the configured values for the keys declared in "params".
- helpers: {
    sma(values: number[], period) => (number|null)[],
    ema(values, period) => (number|null)[],
    rsi(values, period) => (number|null)[],
    atr(candles, period) => (number|null)[],
    highest(values, period) => (number|null)[],
    lowest(values, period) => (number|null)[]
  }
- The returned array MUST be exactly candles.length long.
- Track your own state across bars with a variable (e.g. remember that you entered).
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
          {
            role: "user",
            content:
              parsed.data.answers && parsed.data.answers.length > 0
                ? `${parsed.data.prompt}\n\nAnswers:\n${parsed.data.answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
                : parsed.data.prompt,
          },
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

    const parsed2 = JSON.parse(content) as {
      questions?: unknown;
      name?: string;
      description?: string;
      params?: unknown[];
      code?: string;
    };
    // Model asked clarifying questions instead of generating code.
    if (Array.isArray(parsed2.questions) && parsed2.questions.length > 0) {
      const questions = parsed2.questions
        .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        .slice(0, 4);
      if (questions.length > 0) return NextResponse.json({ data: { questions } });
    }
    const spec = parsed2;
    if (!spec.name || !spec.code || !Array.isArray(spec.params)) {
      return NextResponse.json({ error: "Malformed AI response" }, { status: 502 });
    }
    return NextResponse.json({ data: spec });
  } catch (err) {
    console.error("ai-strategy failed:", err);
    const isNetwork = err instanceof TypeError || (err instanceof Error && err.name === "TimeoutError");
    return NextResponse.json(
      {
        error: isNetwork
          ? "Cannot reach api.openai.com — check network/VPN/proxy and retry"
          : "Failed to generate strategy",
      },
      { status: 500 },
    );
  }
}
