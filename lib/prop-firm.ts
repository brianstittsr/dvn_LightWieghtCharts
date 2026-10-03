/** Prop-firm challenge calculator model (TopStep-style evaluation rules). */

export interface AccountTier {
  size: number;
  label: string;
  maxDrawdown: number;
  /** Evaluation profit target (≈6% of size). */
  profitGoal: number;
  /** Maximum payout allowed per payout cycle. */
  maxPayout: number;
}

export const ACCOUNT_TIERS: AccountTier[] = [
  { size: 25_000, label: "25K", maxDrawdown: 1_500, profitGoal: 1_500, maxPayout: 1_000 },
  { size: 50_000, label: "50K", maxDrawdown: 2_500, profitGoal: 3_000, maxPayout: 2_000 },
  { size: 100_000, label: "100K", maxDrawdown: 3_000, profitGoal: 6_000, maxPayout: 4_000 },
  { size: 150_000, label: "150K", maxDrawdown: 5_000, profitGoal: 9_000, maxPayout: 6_000 },
  { size: 250_000, label: "250K", maxDrawdown: 6_500, profitGoal: 15_000, maxPayout: 10_000 },
  { size: 300_000, label: "300K", maxDrawdown: 7_500, profitGoal: 18_000, maxPayout: 12_000 },
];

export interface FuturesSpec {
  symbol: string;
  name: string;
  micro: boolean;
  tickSize: number;
  tickValue: number;
  /** Dollar value per 1.00 index point. */
  pointValue: number;
}

export const FUTURES_CONTRACTS: FuturesSpec[] = [
  { symbol: "NQ", name: "Nasdaq 100 E-mini", micro: false, tickSize: 0.25, tickValue: 5.0, pointValue: 20 },
  { symbol: "MNQ", name: "Micro Nasdaq 100", micro: true, tickSize: 0.25, tickValue: 0.5, pointValue: 2 },
  { symbol: "ES", name: "S&P 500 E-mini", micro: false, tickSize: 0.25, tickValue: 12.5, pointValue: 50 },
  { symbol: "MES", name: "Micro S&P 500", micro: true, tickSize: 0.25, tickValue: 1.25, pointValue: 5 },
  { symbol: "CL", name: "Crude Oil", micro: false, tickSize: 0.01, tickValue: 10, pointValue: 1000 },
  { symbol: "MCL", name: "Micro Crude Oil", micro: true, tickSize: 0.01, tickValue: 1.0, pointValue: 100 },
  { symbol: "GC", name: "Gold", micro: false, tickSize: 0.1, tickValue: 10, pointValue: 100 },
  { symbol: "MGC", name: "Micro Gold", micro: true, tickSize: 0.1, tickValue: 1.0, pointValue: 10 },
  { symbol: "RTY", name: "Russell 2000 E-mini", micro: false, tickSize: 0.1, tickValue: 5, pointValue: 50 },
  { symbol: "M2K", name: "Micro Russell 2000", micro: true, tickSize: 0.1, tickValue: 0.5, pointValue: 5 },
];

export type RiskLevel = "normal" | "high";
export const RISK_PCT: Record<RiskLevel, number> = { normal: 0.12, high: 0.2 };

/** Fixed stop distance (points) the sizing model assumes per trade. */
export const STOP_POINTS = 80;

export interface ChallengePlan {
  tier: AccountTier;
  riskLevel: RiskLevel;
  dailyLossLimit: number;
  dailyProfit: number;
  /** Trading days to hit the evaluation profit goal. */
  daysToPass: number;
  /** Account balance that banks the drawdown buffer for payout eligibility. */
  bufferBalance: number;
  bufferNeeded: number;
  daysToBuffer: number;
  daysToMaxPayout: number;
  /** Pace variants shown in the summary table. */
  slowDailyTarget: number;
  fastDailyTarget: number;
  /** Recommended daily target as share of the loss limit (≈56%). */
  recommendedDailyTarget: number;
  maxDrawdownPct: number;
}

export function calcChallengePlan(
  tier: AccountTier,
  riskLevel: RiskLevel,
  dailyProfit: number,
): ChallengePlan {
  const dailyLossLimit = tier.maxDrawdown * RISK_PCT[riskLevel];
  const bufferNeeded = Math.ceil(tier.maxDrawdown * 1.04);
  const bufferBalance = tier.size + bufferNeeded;
  const safeDaily = Math.max(1, dailyProfit);
  const daysToPass = Math.ceil(tier.profitGoal / safeDaily);
  const daysToBuffer = Math.ceil(bufferNeeded / safeDaily);
  const daysToMaxPayout =
    daysToPass + daysToBuffer + Math.ceil(tier.maxPayout / safeDaily);
  return {
    tier,
    riskLevel,
    dailyLossLimit,
    dailyProfit: safeDaily,
    daysToPass,
    bufferBalance,
    bufferNeeded,
    daysToBuffer,
    daysToMaxPayout,
    slowDailyTarget: tier.profitGoal / 18,
    fastDailyTarget: tier.profitGoal / 9,
    recommendedDailyTarget: Math.round(dailyLossLimit * 0.56),
    maxDrawdownPct: RISK_PCT[riskLevel],
  };
}

/** Max contracts whose 80-pt stop stays inside the daily loss limit. */
export function maxContracts(spec: FuturesSpec, dailyLossLimit: number): number {
  return Math.floor(dailyLossLimit / (STOP_POINTS * spec.pointValue));
}

export function riskPerContract(spec: FuturesSpec): number {
  return STOP_POINTS * spec.pointValue;
}
