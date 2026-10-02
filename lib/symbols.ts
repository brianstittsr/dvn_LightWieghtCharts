/** Symbol pickers — crypto streams from Hyperliquid, US stocks from Alpaca. */

export interface SymbolOption {
  value: string;
  label: string;
  source: "hyperliquid" | "alpaca";
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

export const ALL_SYMBOLS: SymbolOption[] = [...CRYPTO_SYMBOLS, ...STOCK_SYMBOLS];

export function symbolInfo(value: string): SymbolOption {
  return ALL_SYMBOLS.find((s) => s.value === value) ?? { value, label: value, source: "hyperliquid" };
}

/** Default symbol per pane index so a fresh dashboard shows a mix. */
export const DEFAULT_PANE_SYMBOLS = ["BTC", "ETH", "SOL", "NVDA", "SPY", "HYPE", "AAPL", "DOGE"];
