"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import {
  BROKERS,
  INTERESTS,
  TRADING_STYLES,
} from "@/lib/onboarding-content";
import type { InterestKey, UserProfile } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

const btn =
  "rounded px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-40";
const chip = (on: boolean) =>
  cn(
    "rounded border px-3 py-2 text-left text-xs transition",
    on
      ? "border-[#2962ff] bg-[#2962ff] text-white"
      : "border-[#2a2e39] bg-[#1e222d] text-gray-300 hover:border-gray-500",
  );

const STEPS = ["About you", "Brokers", "Interests", "Done"] as const;

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function OnboardingWizard({
  userEmail,
  onDone,
}: {
  userEmail: string | null;
  onDone: (profile: UserProfile) => void;
}) {
  const [step, setStep] = useState(0);
  const [styles, setStyles] = useState<string[]>(["day"]);
  const [experience, setExperience] = useState<UserProfile["experience"]>("beginner");
  const [brokers, setBrokers] = useState<string[]>([]);
  const [interests, setInterests] = useState<InterestKey[]>(["premarket"]);
  const [emailMsg, setEmailMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const noBroker = brokers.includes("none");

  const finish = async (skipped = false) => {
    setBusy(true);
    const profile: UserProfile = {
      onboarded: true,
      tradingStyles: skipped ? [] : styles,
      experience,
      brokers: skipped ? [] : brokers,
      interests: skipped ? [] : interests,
      guideProgress: {},
      completedAt: new Date().toISOString(),
    };
    await authFetch("/api/user-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    }).catch(() => {});
    setBusy(false);
    onDone(profile);
  };

  const emailInstructions = async (brokerId: string) => {
    const broker = BROKERS.find((b) => b.id === brokerId);
    setEmailMsg("");
    const res = await authFetch("/api/email-instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broker: brokerId }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.data?.sent) return setEmailMsg(`✅ Emailed to ${userEmail}`);
    // 501 → mailto fallback (provider env not configured).
    if (userEmail && broker?.emailSubject && broker.emailBody) {
      window.open(
        `mailto:${userEmail}?subject=${encodeURIComponent(broker.emailSubject)}` +
          `&body=${encodeURIComponent(broker.emailBody)}`,
        "_self",
      );
      return setEmailMsg("Opening your mail app with the instructions…");
    }
    setEmailMsg(d.error ?? "Couldn't send");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[#2a2e39] bg-[#131722] p-6 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold">👋 Welcome — let&apos;s set up your workspace</h2>
          <button onClick={() => finish(true)} className="text-[10px] text-gray-500 hover:text-gray-300">
            Skip — show everything
          </button>
        </div>
        <div className="mb-4 flex gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className={cn(
              "flex-1 rounded px-1 py-1 text-center text-[10px] font-semibold",
              i === step ? "bg-[#2962ff] text-white" : i < step ? "bg-[#1e7a3c]/60 text-emerald-200" : "bg-neutral-800 text-gray-500",
            )}>
              {i + 1}. {s}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-300">How do you trade?</p>
              <div className="grid grid-cols-2 gap-2">
                {TRADING_STYLES.map((s) => (
                  <button key={s.id} onClick={() => setStyles(toggle(styles, s.id))} className={chip(styles.includes(s.id))}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-300">Experience level</p>
              <div className="grid grid-cols-3 gap-2">
                {(["beginner", "intermediate", "advanced"] as const).map((e) => (
                  <button key={e} onClick={() => setExperience(e)} className={chip(experience === e)}>
                    {e[0].toUpperCase() + e.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-300">Which brokers / platforms do you use?</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {BROKERS.map((b) => (
                <button key={b.id}
                  onClick={() => setBrokers(toggle(brokers.filter((x) => x !== "none"), b.id))}
                  className={chip(brokers.includes(b.id))}>
                  {b.label}
                </button>
              ))}
              <button
                onClick={() => setBrokers(noBroker ? [] : ["none"])}
                className={chip(noBroker)}>
                I don&apos;t have a broker yet
              </button>
            </div>

            {noBroker && (
              <div className="rounded border border-[#2962ff]/40 bg-[#1a2338] p-3 text-xs">
                <p className="mb-1 font-semibold text-[#8ab4ff]">Get started free with Alpaca paper trading:</p>
                <ul className="list-inside space-y-1 text-gray-300">
                  {BROKERS.find((b) => b.id === "alpaca")?.inlineSteps?.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {brokers.filter((b) => b !== "none").map((id) => {
              const broker = BROKERS.find((b) => b.id === id);
              if (!broker) return null;
              return (
                <div key={id} className="rounded border border-[#2a2e39] bg-[#1e222d] p-3 text-xs">
                  <p className="mb-1 font-semibold text-gray-200">{broker.label}</p>
                  {broker.inlineSteps && (
                    <ul className="mb-2 list-inside space-y-0.5 text-[11px] text-gray-400">
                      {broker.inlineSteps.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                  <button onClick={() => emailInstructions(id)}
                    className={cn(btn, "bg-neutral-700 hover:bg-neutral-600 !py-1 !px-2 text-[10px]")}>
                    📧 Email me the setup instructions
                  </button>
                </div>
              );
            })}
            {emailMsg && <p className="text-[11px] text-emerald-400">{emailMsg}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <p className="mb-2 text-xs font-semibold text-gray-300">
              What do you want to use? (we&apos;ll only show those features)
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {INTERESTS.map((i) => (
                <button key={i.id}
                  onClick={() => setInterests(toggle(interests, i.id) as InterestKey[])}
                  className={chip(interests.includes(i.id))}>
                  <p className="font-semibold">{i.label}</p>
                  <p className={cn("mt-0.5 text-[10px]", interests.includes(i.id) ? "text-blue-100" : "text-gray-500")}>
                    {i.desc}
                  </p>
                </button>
              ))}
            </div>
            {interests.length === 0 && (
              <p className="text-[10px] text-amber-400">
                Nothing selected — we&apos;ll show all features.
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-xs">
            <p className="font-semibold text-gray-300">All set! Here&apos;s your workspace:</p>
            <ul className="list-inside space-y-1 text-gray-400">
              <li>• Trading style: {styles.join(", ") || "—"} · {experience}</li>
              <li>• Brokers: {brokers.length === 0 ? "none" : brokers.join(", ")}</li>
              <li>• Features: {interests.length === 0 ? "everything" : interests.map((i) => INTERESTS.find((x) => x.id === i)?.label).join(", ")}</li>
            </ul>
            <p className="rounded border border-[#2a2e39] bg-[#1e222d] p-2 text-[11px] text-gray-400">
              Your dashboard will show a step-by-step guide for these features —
              check steps off as you complete them. You can re-run this setup
              anytime from your profile settings.
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className={cn(btn, "bg-neutral-700")}>
              ← Back
            </button>
          )}
          <div className="ml-auto">
            {step < 3 ? (
              <button onClick={() => setStep(step + 1)} className={cn(btn, "bg-[#2962ff] hover:bg-[#1e53e5]")}>
                Next →
              </button>
            ) : (
              <button onClick={() => finish(false)} disabled={busy}
                className={cn(btn, "bg-[#1e7a3c] hover:bg-[#259a4b]")}>
                {busy ? "Saving…" : "Enter the app →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
