/** Symbol pickers — crypto streams from Hyperliquid, US stocks from Alpaca,
 * futures from TopStepX/ProjectX. */

export interface SymbolOption {
  value: string;
  label: string;
  source: "hyperliquid" | "alpaca" | "futures";
}

export const CRYPTO_SYMBOLS: SymbolOption[] = [
  { value: "BTC", label: "BTC / USD", source: "hyperliquid" },
  { value: "ETH", label: "ETH / USD", source: "hyperliquid" },
  { value: "SOL", label: "SOL / USD", source: "hyperliquid" },
  { value: "HYPE", label: "HYPE / USD", source: "hyperliquid" },
  { value: "DOGE", label: "DOGE / USD", source: "hyperliquid" },
  { value: "ARB", label: "ARB / USD", source: "hyperliquid" },
];

export const STOCK_SYMBOLS: SymbolOption[] = [
  { value: "AAPL", label: "Apple", source: "alpaca" },
  { value: "MSFT", label: "Microsoft", source: "alpaca" },
  { value: "NVDA", label: "NVIDIA", source: "alpaca" },
  { value: "TSLA", label: "Tesla", source: "alpaca" },
  { value: "AMZN", label: "Amazon", source: "alpaca" },
  { value: "META", label: "Meta", source: "alpaca" },
  { value: "GOOGL", label: "Alphabet", source: "alpaca" },
  { value: "AMD", label: "AMD", source: "alpaca" },
  { value: "SPY", label: "S&P 500 ETF", source: "alpaca" },
  { value: "QQQ", label: "Nasdaq 100 ETF", source: "alpaca" },
];

/** Top 10 futures roots — resolved to front-month contracts via TopStepX. */
export const FUTURE_SYMBOLS: SymbolOption[] = [
  { value: "NQ", label: "NQ — Nasdaq 100 E-mini", source: "futures" },
  { value: "MNQ", label: "MNQ — Micro Nasdaq 100", source: "futures" },
  { value: "ES", label: "ES — S&P 500 E-mini", source: "futures" },
  { value: "MES", label: "MES — Micro S&P 500", source: "futures" },
  { value: "CL", label: "CL — Crude Oil", source: "futures" },
  { value: "MCL", label: "MCL — Micro Crude Oil", source: "futures" },
  { value: "GC", label: "GC — Gold", source: "futures" },
  { value: "MGC", label: "MGC — Micro Gold", source: "futures" },
  { value: "RTY", label: "RTY — Russell 2000 E-mini", source: "futures" },
  { value: "M2K", label: "M2K — Micro Russell 2000", source: "futures" },
];

export const ALL_SYMBOLS: SymbolOption[] = [
  ...CRYPTO_SYMBOLS,
  ...STOCK_SYMBOLS,
  ...FUTURE_SYMBOLS,
];

export function symbolInfo(value: string): SymbolOption {
  return ALL_SYMBOLS.find((s) => s.value === value) ?? { value, label: value, source: "hyperliquid" };
}

/** Default symbol per pane index so a fresh dashboard shows a mix. */
export const DEFAULT_PANE_SYMBOLS = ["BTC", "ETH", "SOL", "NVDA", "SPY", "HYPE", "AAPL", "DOGE"];
