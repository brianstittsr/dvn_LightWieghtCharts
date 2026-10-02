import { symbolInfo } from "@/lib/symbols";

/**
 * Map a pane symbol to an Alpaca-tradable symbol: crypto base tickers become
 * "BTC/USD" pairs, US stocks pass through unchanged.
 */
export function toAlpacaSymbol(paneSymbol: string): string {
  if (paneSymbol.includes("/")) return paneSymbol;
  if (symbolInfo(paneSymbol).source === "alpaca") return paneSymbol;
  return `${paneSymbol}/USD`;
}
