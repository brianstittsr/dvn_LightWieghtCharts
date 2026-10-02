"use client";

import { useEffect, useRef, useState } from "react";
import { BUILTIN_INDICATORS, SOURCES } from "@/lib/indicators/builtin";
import { deleteCustomIndicator } from "@/lib/indicators/custom";
import type { IndicatorDef, IndicatorInstance, ParamDef } from "@/lib/indicators/types";

interface IndicatorMenuProps {
  instances: IndicatorInstance[];
  defs: IndicatorDef[];
  customDefs: IndicatorDef[];
  onAdd: (defId: string) => void;
  onRemove: (index: number) => void;
  onParamChange: (index: number, key: string, value: number | string) => void;
  onGenerated: (spec: { name: string; params: ParamDef[]; code: string }) => void;
  onCustomDeleted: () => void;
}

function ParamInput({
  def,
  value,
  onChange,
}: {
  def: ParamDef;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  if (def.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(Number(value))}
        onChange={(e) => {
          if (e.target.checked && "Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().catch(() => {});
          }
          onChange(e.target.checked ? 1 : 0);
        }}
        className="h-3.5 w-3.5 accent-blue-500"
      />
    );
  }
  if (def.type === "color") {
    return (
      <input
        type="color"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-neutral-700 bg-neutral-800"
      />
    );
  }
  if (def.type === "source") {
    return (
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="rounded bg-neutral-800 px-1 py-0.5 text-xs text-neutral-200"
      >
        {SOURCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="number"
      value={Number(value)}
      min={def.min}
      max={def.max}
      step={def.step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-16 rounded bg-neutral-800 px-1 py-0.5 text-xs text-neutral-200"
    />
  );
}

export function IndicatorMenu({
  instances,
  defs,
  customDefs,
  onAdd,
  onRemove,
  onParamChange,
  onGenerated,
  onCustomDeleted,
}: IndicatorMenuProps) {
  const [open, setOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function generate() {
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai-indicator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const body = (await res.json()) as { data?: { name: string; params: ParamDef[]; code: string }; error?: string };
      if (!res.ok || !body.data) throw new Error(body.error ?? "Generation failed");
      onGenerated(body.data);
      setAiPrompt("");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setAiBusy(false);
    }
  }

  const allDefs = [...BUILTIN_INDICATORS, ...customDefs];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
        title="Indicators"
      >
        ƒx{instances.length > 0 ? ` ${instances.length}` : ""}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Active
          </div>
          {instances.length === 0 && <div className="mb-2 text-xs text-neutral-500">None</div>}
          {instances.map((inst, i) => {
            const def = defs.find((d) => d.id === inst.defId) ?? allDefs.find((d) => d.id === inst.defId);
            if (!def) return null;
            return (
              <div key={i} className="mb-2 rounded border border-neutral-800 p-1.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-200">{def.name}</span>
                  <button
                    onClick={() => onRemove(i)}
                    className="text-xs text-neutral-500 hover:text-red-400"
                    aria-label="Remove indicator"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {def.params.map((pd) => (
                    <label key={pd.key} className="flex items-center gap-1 text-[10px] text-neutral-400">
                      {pd.label}
                      <ParamInput
                        def={pd}
                        value={inst.params[pd.key] ?? pd.default}
                        onChange={(v) => onParamChange(i, pd.key, v)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Add indicator
          </div>
          <div className="max-h-36 overflow-y-auto">
            {BUILTIN_INDICATORS.map((d) => (
              <button
                key={d.id}
                onClick={() => onAdd(d.id)}
                className="block w-full rounded px-1.5 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800"
              >
                {d.name}
              </button>
            ))}
            {customDefs.map((d) => (
              <div key={d.id} className="flex items-center">
                <button
                  onClick={() => onAdd(d.id)}
                  className="block flex-1 rounded px-1.5 py-1 text-left text-xs text-cyan-300 hover:bg-neutral-800"
                >
                  {d.name}
                </button>
                <button
                  onClick={() => {
                    deleteCustomIndicator(d.id.replace(/^custom:/, ""));
                    onCustomDeleted();
                  }}
                  className="px-1 text-xs text-neutral-600 hover:text-red-400"
                  aria-label="Delete custom indicator"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Generate with AI
          </div>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder='e.g. "A 14-period RSI plotted as a line" or "VWAP bands at 2 standard deviations"'
            rows={2}
            className="w-full resize-none rounded bg-neutral-800 p-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
          />
          <button
            onClick={generate}
            disabled={aiBusy || aiPrompt.trim().length < 3}
            className="mt-1 w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {aiBusy ? "Generating…" : "Create indicator"}
          </button>
          {aiError && <div className="mt-1 text-[10px] text-red-400">{aiError}</div>}
        </div>
      )}
    </div>
  );
}
