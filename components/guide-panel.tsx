"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { GUIDE_STEPS, INTERESTS } from "@/lib/onboarding-content";
import type { UserProfile } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

/**
 * "Your setup path" — collapsible checklist of guided steps derived from the
 * user's onboarding interests. Progress persists to profile.guideProgress.
 */
export function GuidePanel({
  profile,
  onChange,
}: {
  profile: UserProfile;
  onChange: (p: UserProfile) => void;
}) {
  const [open, setOpen] = useState(true);

  const groups = profile.interests
    .map((i) => ({
      interest: INTERESTS.find((x) => x.id === i),
      steps: GUIDE_STEPS[i] ?? [],
    }))
    .filter((g) => g.interest && g.steps.length > 0);

  const total = groups.reduce((n, g) => n + g.steps.length, 0);
  const done = Object.values(profile.guideProgress).filter(Boolean).length;
  if (profile.guideDismissed || total === 0 || done === total) return null;

  const toggleStep = (id: string) => {
    const next: UserProfile = {
      ...profile,
      guideProgress: {
        ...profile.guideProgress,
        [id]: !profile.guideProgress[id],
      },
    };
    onChange(next);
    void authFetch("/api/user-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: next }),
    });
  };

  const dismiss = () => {
    const next = { ...profile, guideDismissed: true };
    onChange(next);
    void authFetch("/api/user-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: next }),
    });
  };

  return (
    <div className="rounded-lg border border-[#2a2e39] bg-[#131722] p-3 text-xs">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2">
        <span className="font-semibold">🧭 Your setup path</span>
        <span className="text-[10px] text-gray-500">
          {done}/{total} done
        </span>
        <span className="ml-auto text-gray-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {groups.map((g) => (
            <div key={g.interest!.id}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                {g.interest!.label}
              </p>
              <ul className="space-y-1">
                {g.steps.map((s) => {
                  const checked = Boolean(profile.guideProgress[s.id]);
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => toggleStep(s.id)}
                        className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-[#1e222d]"
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[9px]",
                            checked
                              ? "border-emerald-500 bg-emerald-600 text-white"
                              : "border-gray-600",
                          )}
                        >
                          {checked ? "✓" : ""}
                        </span>
                        <span>
                          <span className={cn(checked && "text-gray-500 line-through")}>
                            {s.label}
                          </span>
                          {s.hint && (
                            <span className="block text-[10px] text-gray-500">{s.hint}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <button onClick={dismiss} className="text-[10px] text-gray-600 hover:text-gray-400">
            Dismiss guide
          </button>
        </div>
      )}
    </div>
  );
}
