import { z } from "zod";

/** App-wide settings editable from the admin page, stored in data/settings.json. */

export const appSettingsSchema = z.object({
  defaultChartCount: z.number().int().min(1).max(8).default(4),
  defaultTimeframe: z.string().default("15m"),
  positionPollMs: z.number().int().min(3000).max(120000).default(15000),
  alertsEnabled: z.boolean().default(true),
  backtest: z
    .object({
      initialCapital: z.number().positive().default(10000),
      riskPerTrade: z.number().positive().max(50).default(1),
      commission: z.number().min(0).default(1),
      slippagePct: z.number().min(0).max(5).default(0.02),
    })
    .default({ initialCapital: 10000, riskPerTrade: 1, commission: 1, slippagePct: 0.02 }),
  sessions: z
    .object({
      asiaStart: z.number().min(0).max(23).default(19),
      asiaEnd: z.number().min(0).max(23).default(3),
      londonStart: z.number().min(0).max(23).default(3),
      londonEnd: z.number().min(0).max(23).default(8),
      nyStart: z.number().min(0).max(23).default(8),
      nyEnd: z.number().min(0).max(23).default(17),
    })
    .default({
      asiaStart: 19, asiaEnd: 3, londonStart: 3, londonEnd: 8, nyStart: 8, nyEnd: 17,
    }),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({});

/** Trading account managed from the admin page (one per platform credential set). */
export interface TradingAccount {
  id: string;
  name: string;
  platform: "alpaca" | "topstep" | "apex" | "schwab" | "ninjatrader";
  apiKey?: string;
  apiSecret?: string;
  notes?: string;
  createdAt: string;
}

/** Account shape returned by the API — secrets masked. */
export interface PublicAccount extends Omit<TradingAccount, "apiKey" | "apiSecret"> {
  apiKeyMasked?: string;
  hasSecret: boolean;
}

const mask = (v?: string): string | undefined =>
  v ? `••••${v.slice(-4)}` : undefined;

export function toPublic(a: TradingAccount): PublicAccount {
  return {
    id: a.id,
    name: a.name,
    platform: a.platform,
    notes: a.notes,
    createdAt: a.createdAt,
    apiKeyMasked: mask(a.apiKey),
    hasSecret: Boolean(a.apiSecret),
  };
}
