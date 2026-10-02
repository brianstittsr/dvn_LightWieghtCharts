"use client";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  type User,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState, type ReactNode } from "react";
import { firebaseConfigured, getClientAuth, getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/schema";

/**
 * Route guard: shows a Firebase email/password login until a user is signed in,
 * then renders children. Falls back to an open pass-through if Firebase env
 * vars aren't configured (local dev without auth).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // When Firebase isn't configured there's nothing to wait for.
  const [ready, setReady] = useState(() => !firebaseConfigured);

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) return; // ready already true
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0e11] text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  if (!firebaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0e11] px-4">
        <div className="max-w-sm rounded-xl border border-amber-700/50 bg-amber-900/20 p-6 text-sm text-amber-300">
          Firebase auth is not configured. Set the{" "}
          <code>NEXT_PUBLIC_FIREBASE_*</code> variables in{" "}
          <code>.env.local</code> and restart the dev server.
        </div>
      </div>
    );
  }
  if (!user) return <LoginScreen />;
  return <>{children}</>;
}

function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const friendly = (code: string): string =>
    ({
      "auth/invalid-credential": "Wrong email or password.",
      "auth/user-not-found": "No account for that email.",
      "auth/wrong-password": "Wrong email or password.",
      "auth/email-already-in-use": "An account already exists for that email.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/invalid-email": "Invalid email address.",
    })[code] ?? "Authentication failed — try again.";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const auth = getClientAuth();
    if (!auth) return;
    setBusy(true);
    setErr("");
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const db = getDb();
        if (db) {
          await setDoc(doc(db, COLLECTIONS.USERS, cred.user.uid), {
            uid: cred.user.uid,
            displayName: email.split("@")[0],
            email,
            role: "trader",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (ex) {
      const code =
        typeof ex === "object" && ex && "code" in ex
          ? String((ex as { code: unknown }).code)
          : "";
      setErr(friendly(code));
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded border border-[#2a2e39] bg-[#0b0e11] px-3 py-2 text-sm text-gray-200 outline-none focus:border-[#2962ff]";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0e11]">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-[#2a2e39] bg-[#131722] p-8"
      >
        <h1 className="text-xl font-bold text-white">Trading Dashboard</h1>
        <p className="mb-6 mt-1 text-xs text-gray-500">
          {mode === "signin" ? "Sign in to continue" : "Create your account"}
        </p>

        <label className="mb-1 block text-xs text-gray-400" htmlFor="auth-email">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${input} mb-3`}
        />

        <label className="mb-1 block text-xs text-gray-400" htmlFor="auth-pw">
          Password
        </label>
        <input
          id="auth-pw"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${input} mb-4`}
        />

        {err && <p className="mb-3 text-xs text-red-400">{err}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-[#2962ff] py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setErr("");
          }}
          className="mt-4 w-full text-center text-xs text-[#2962ff] hover:underline"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
