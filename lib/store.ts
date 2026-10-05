import { adminConfigured, adminDb } from "@/lib/firebase-admin";
import { readJson, writeJson } from "@/lib/server-store";

/**
 * Dual-backend server store.
 *
 * - Firestore (Admin SDK) when FIREBASE_* env vars are set — the backend used
 *   on the deployed app, where the filesystem is ephemeral/read-only.
 * - JSON files under data/ otherwise — local dev without a service account.
 *
 * Call sites keep using the JSON filename ("users.json") — it maps to the
 * Firestore collection of the same domain.
 */

type StoreFile =
  | "users.json"
  | "futures-bots.json"
  | "bots.json"
  | "scanner-configs.json"
  | "scan-runs.json"
  | "user-settings.json"
  | "watchlists.json";
const COLLECTIONS: Record<StoreFile, string> = {
  "users.json": "tradingAccounts",
  "futures-bots.json": "futuresBots",
  "bots.json": "alpacaBots",
  "scanner-configs.json": "scannerConfigs",
  "scan-runs.json": "scanRuns",
  "user-settings.json": "userSettings",
  "watchlists.json": "watchlists",
};

const SETTINGS_DOC = "appSettings/app";

/**
 * One-time probe: env vars present AND a real Firestore call succeeds.
 * A malformed FIREBASE_PRIVATE_KEY (e.g. real newlines pasted into Vercel)
 * passes adminConfigured() but throws here — cache the failure so every
 * request degrades to the JSON store instead of 500-ing.
 */
let probe: Promise<boolean> | null = null;
function firestore(): Promise<boolean> {
  probe ??= (async () => {
    try {
      if (!adminConfigured()) return false;
      await (await adminDb()).listCollections(); // validates the creds for real
      return true;
    } catch (e) {
      console.error(
        "[store] Firestore unavailable — falling back to data/*.json:",
        e instanceof Error ? e.message : e,
      );
      return false;
    }
  })();
  return probe;
}

interface Entity {
  id: string;
}

/** All documents in a store (Firestore collection or JSON array file). */
export async function storeList<T>(file: StoreFile): Promise<T[]> {
  if (await firestore()) {
    const snap = await (await adminDb()).collection(COLLECTIONS[file]).get();
    return snap.docs.map((d) => d.data() as T);
  }
  const list = await readJson<T[]>(file, []);
  return Array.isArray(list) ? list : [];
}

/** Upsert one document (matched by its `id` field / document id). */
export async function storePut<T extends Entity>(
  file: StoreFile,
  doc: T,
): Promise<void> {
  if (await firestore()) {
    await (await adminDb()).collection(COLLECTIONS[file]).doc(doc.id).set(doc);
    return;
  }
  const list = await storeList<T>(file);
  const i = list.findIndex((d) => d.id === doc.id);
  if (i >= 0) list[i] = doc;
  else list.push(doc);
  await writeJson(file, list);
}

export async function storeDelete(file: StoreFile, id: string): Promise<void> {
  if (await firestore()) {
    await (await adminDb()).collection(COLLECTIONS[file]).doc(id).delete();
    return;
  }
  const list = await storeList<Entity>(file);
  await writeJson(
    file,
    list.filter((d) => d.id !== id),
  );
}

/** App-wide settings document (single doc, not a collection of entities). */
export async function getSettingsDoc<T>(fallback: T): Promise<T> {
  if (await firestore()) {
    const snap = await (await adminDb()).doc(SETTINGS_DOC).get();
    return (snap.exists ? (snap.data() as T) : fallback) ?? fallback;
  }
  return readJson<T>("settings.json", fallback);
}

export async function putSettingsDoc<T>(value: T): Promise<void> {
  if (await firestore()) {
    await (await adminDb()).doc(SETTINGS_DOC).set(value as Record<string, unknown>);
    return;
  }
  await writeJson("settings.json", value);
}
