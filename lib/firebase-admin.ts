import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

/** Server-side Firebase Admin — env-driven singleton. */

export function adminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY,
  );
}

/**
 * Lazy dynamic imports: the firebase-admin bundle only loads on first use.
 * If the package ever fails to initialize in a serverless runtime, the throw
 * happens at call time — inside callers' try/catch — instead of crashing the
 * route module (and every route that transitively imports it) at load time.
 */
let appPromise: Promise<App> | null = null;
function adminApp(): Promise<App> {
  appPromise ??= (async () => {
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const existing = getApps();
    if (existing.length) return existing[0];
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // env-stored keys carry literal \n sequences
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  })();
  return appPromise;
}

export async function adminAuth(): Promise<Auth> {
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(await adminApp());
}

export async function adminDb(): Promise<Firestore> {
  const { getFirestore } = await import("firebase-admin/firestore");
  return getFirestore(await adminApp());
}
