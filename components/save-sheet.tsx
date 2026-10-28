"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Flag, X } from "lucide-react";
import { fmtClock } from "@/lib/time";

export type ClipLength = { label: string; before: number; after: number };

/** How much of the recording a saved moment keeps around it. */
const LENGTHS: ClipLength[] = [
  { label: "10 s", before: 6000, after: 4000 },
  { label: "16 s", before: 8000, after: 8000 },
  { label: "30 s", before: 20000, after: 10000 },
];
/** One tap fills the label: what courtside disputes are usually about. */
const TAGS = ["Double bounce", "Glass first", "Net touch", "Ball on the mesh", "Let", "Point of the match"];

/** "Save this moment": a label (typed or one tap), how long a clip, then the
 *  console cuts every camera and shows the share link. A bottom sheet on a
 *  phone, a dialog on a bigger screen. */
export function SaveSheet({
  center,
  incident,
  onCancel,
  onSave,
}: {
  center: number;
  incident: boolean;
  onCancel: () => void;
  onSave: (label: string, len: ClipLength) => void;
}) {
  const [label, setLabel] = useState("");
  const [len, setLen] = useState(LENGTHS[1]);
  const input = useRef<HTMLInputElement>(null);
  // the console re-renders ten times a second with a new onCancel each time
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });

  useEffect(() => {
    // a phone opens the keyboard only for a focus inside a user gesture, so
    // this is for keyboards; on a phone the tags are the quick way
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
    const h = (e: KeyboardEvent) => e.key === "Escape" && cancel.current();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(label.trim(), len);
  };

  return (
    <div className="fixed inset-0 z-50 grid items-end sm:items-center justify-items-center sheet-backdrop" onClick={onCancel}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="sheet glass w-full sm:max-w-md rounded-t-[1.75rem] sm:rounded-[1.75rem] p-5 sm:p-6 space-y-4"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-title"
      >
        <div className="flex items-start gap-3">
          <span className="grid place-items-center h-11 w-11 shrink-0 rounded-2xl bg-[var(--accent-2)] text-[var(--accent)]">
            <BookmarkPlus className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="save-title" className="display text-3xl leading-none pt-1">
              Save the moment
            </h2>
            <p className="text-sm muted flex items-center gap-1.5 pt-1 tabular-nums">
              {incident && <Flag className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden />}
              {incident ? "Around the incident at" : "Around"} {fmtClock(center)}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="!min-h-9 !px-2 btn-ghost" aria-label="close">
            <X className="icon" aria-hidden />
          </button>
        </div>

        <label className="block text-sm space-y-1.5">
          <span className="muted">Label</span>
          <input
            ref={input}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder="What happened? (optional)"
            className="field"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className="seg !min-h-8 !px-3 !rounded-full text-xs"
              aria-pressed={label === t}
              onClick={() => setLabel(label === t ? "" : t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm muted">Clip length</span>
          <div className="grid grid-cols-3 gap-1.5">
            {LENGTHS.map((l) => (
              <button key={l.label} type="button" className="seg" aria-pressed={len === l} onClick={() => setLen(l)}>
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-xs muted">
            {len.before / 1000} s before and {len.after / 1000} s after, every camera.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-brand">
            <BookmarkPlus className="icon" aria-hidden />
            Save moment
          </button>
        </div>
      </form>
    </div>
  );
}
