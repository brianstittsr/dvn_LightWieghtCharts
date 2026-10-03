import type { Watchlist } from "@/lib/scanner/types";
import { storeList } from "@/lib/store";

/** Resolve a caller's watchlist id → symbols; undefined if not found. */
export async function watchlistSymbols(
  uid: string,
  watchlistId: string | undefined,
): Promise<string[] | undefined> {
  if (!watchlistId) return undefined;
  const wl = (await storeList<Watchlist>("watchlists.json")).find(
    (w) => w.id === watchlistId && w.uid === uid,
  );
  return wl?.symbols;
}
