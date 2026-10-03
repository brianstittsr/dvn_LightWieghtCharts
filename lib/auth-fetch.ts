"use client";

import { getClientAuth } from "@/lib/firebase";

/** fetch() that attaches the current Firebase ID token, when signed in. */
export async function authFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const auth = getClientAuth();
  // Wait for Firebase to restore the persisted session — otherwise early
  // calls (e.g. the auto-opened futures ticket) fire before currentUser is
  // populated and the request goes out unauthenticated.
  await auth?.authStateReady?.().catch(() => {});
  const token = await auth?.currentUser?.getIdToken();
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
