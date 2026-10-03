"use client";

import { getClientAuth } from "@/lib/firebase";

/** fetch() that attaches the current Firebase ID token, when signed in. */
export async function authFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const auth = getClientAuth();
  const token = await auth?.currentUser?.getIdToken();
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
