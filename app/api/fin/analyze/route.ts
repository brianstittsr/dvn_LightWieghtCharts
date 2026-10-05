import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finChat, finAvailable, extractJson, FinUnavailableError, FIN_MODEL_NAME } from "@/lib/ai";
import { verifyUser } from "@/lib/server-auth";

const runSchema = z.object({
  params: z.record(z.string(), z.number()),
  returnPercent: z.number(),
  profitFactor: z.number(),
  maxDrawdownPercent: z.number(),
  winRate: z.number(),
  totalTrades: z.number(),
});

const bodySchema = z.object({
  context: z.object({
    symbol: z.string().min(1).max(15),
    assetClass: z.enum(["stock", "crypto", "future"]),
    tf: z.string().max(6),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    strategy: z.string().max(80),
    bars: z.number().int().nonnegative(),
    combos: z.number().int().nonnegative(),
  }),
  topRuns: z.array(runSchema).max(20),
  worstRun: runSchema.optional(),
});

const SYSTEM = `You are a quantitative trading analyst reviewing parameter-sweep backtest results.

Analyze the optimization runs provided. Your job:
1. Identify WHICH parameter values drive performance — look for trends (e.g. longer lookbacks winning = trending regime).
2. Flag overfitting risks: results with few trades, single huge winners, or parameters at grid edges.
3. Assess regime fit — does the optimal config suggest trending, mean-reverting, or choppy conditions in this window?
4. Propose refined parameter ranges for a second, tighter sweep.

Return ONLY a JSON object:
{
  "analysis": "2-4 sentences on what the results show",
  "regime": "trending | mean-reverting | choppy | unclear",
  "overfitWarnings": ["warning 1", "..."],
  "suggestedRanges": { "paramKey": { "min": number, "max": number } },
  "confidence": "low | medium | high"
}

Only include suggestedRanges for parameter keys present in the runs. Keep suggestions grounded in what actually won — narrow around winning values rather than guessing new territory.`;

interface Run {
  params: Record<string, number>;
  returnPercent: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  winRate: number;
  totalTrades: number;
}

function buildPrompt(ctx: z.infer<typeof bodySchema>["context"], topRuns: Run[], worst?: Run): string {
  const days = Math.round((ctx.to - ctx.from) / 86400);
  const lines = [
    `Symbol: ${ctx.symbol} (${ctx.assetClass}), timeframe ${ctx.tf}, ${days}-day window, ${ctx.bars} bars`,
    `Strategy: ${ctx.strategy} — ${ctx.combos} parameter combinations tested`,
    "",
    "Top runs (ranked by return minus drawdown penalty):",
    ...topRuns.map(
      (r, i) =>
        `#${i + 1} params=${JSON.stringify(r.params)} → return ${r.returnPercent.toFixed(2)}%, PF ${r.profitFactor.toFixed(2)}, maxDD ${r.maxDrawdownPercent.toFixed(2)}%, win ${r.winRate.toFixed(0)}%, ${r.totalTrades} trades`,
    ),
  ];
  if (worst) {
    lines.push(
      "",
      `Worst run: params=${JSON.stringify(worst.params)} → return ${worst.returnPercent.toFixed(2)}%, maxDD ${worst.maxDrawdownPercent.toFixed(2)}%, ${worst.totalTrades} trades`,
    );
  }
  return lines.join("\n");
}

interface FinAnalysis {
  analysis?: string;
  regime?: string;
  overfitWarnings?: string[];
  suggestedRanges?: Record<string, { min: number; max: number }>;
  confidence?: string;
}

async function openAiFallback(prompt: string): Promise<FinAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  const parsed = extractJson(content) as FinAnalysis | null;
  return parsed;
}

/** POST — Fin-R1 analysis of an optimization sweep's results. */
export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;
  if (!b.topRuns.length) return NextResponse.json({ error: "No runs to analyze" }, { status: 400 });

  const prompt = buildPrompt(b.context, b.topRuns, b.worstRun);

  // Prefer local Fin-R1; fall back to OpenAI when LM Studio is down.
  let provider = FIN_MODEL_NAME;
  let analysis: FinAnalysis | null = null;
  try {
    const res = await finChat({ system: SYSTEM, user: prompt, json: true, temperature: 0.2 });
    analysis = extractJson(res.content) as FinAnalysis | null;
    if (!analysis) {
      // Reasoning models may emit prose only — still useful.
      analysis = { analysis: res.content.slice(0, 4000), confidence: "low" };
    }
  } catch (e) {
    if (!(e instanceof FinUnavailableError)) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message.slice(0, 300) : "Model error" },
        { status: 502 },
      );
    }
    analysis = await openAiFallback(prompt);
    provider = "gpt-4o-mini";
    if (!analysis) {
      return NextResponse.json(
        { error: "LM Studio unreachable and no OPENAI_API_KEY fallback — start LM Studio with Fin-R1 loaded" },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({ provider, ...analysis });
}

/** GET — probe whether the local model server is up. */
export async function GET() {
  const status = await finAvailable();
  return NextResponse.json({ ...status, model: FIN_MODEL_NAME });
}
