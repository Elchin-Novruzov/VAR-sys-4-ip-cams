"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Segment } from "@/lib/types";
import { fmtClock } from "@/lib/time";

/** The replay window as a bar. Green = recorded, gap = nothing recorded.
 *  Dragging shows the time under the finger; releasing loads that moment. */
export function Timeline({
  from,
  to,
  segments,
  current,
  onPick,
}: {
  from: number;
  to: number;
  segments: Segment[];
  current: number | null;
  onPick: (ms: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const span = Math.max(1, to - from);
  const pct = (ms: number) => ((ms - from) / span) * 100;

  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return from + f * span;
  };

  const down = (e: PointerEvent) => {
    dragging.current = true;
    ref.current?.setPointerCapture(e.pointerId);
    setHover(timeAt(e.clientX));
  };
  const move = (e: PointerEvent) => {
    if (dragging.current || e.pointerType === "mouse") setHover(timeAt(e.clientX));
  };
  const up = (e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    onPick(timeAt(e.clientX));
    if (e.pointerType !== "mouse") setHover(null);
  };

  // hour / half-hour ticks
  const ticks: number[] = [];
  const step = span > 3 * 3600_000 ? 3600_000 : span > 40 * 60_000 ? 1800_000 : 600_000;
  for (let t = Math.ceil(from / step) * step; t < to; t += step) ticks.push(t);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}>
        <span>{fmtClock(from)}</span>
        <span>{hover !== null ? `↳ ${fmtClock(hover)}` : "drag to pick a moment"}</span>
        <span>{fmtClock(to)} (latest)</span>
      </div>
      <div
        ref={ref}
        className="relative h-9 sm:h-12 rounded-lg overflow-hidden touch-none"
        style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          dragging.current = false;
          setHover(null);
        }}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null);
        }}
      >
        {segments.map((s, i) => {
          const a = new Date(s.start).getTime();
          const b = a + s.duration * 1000;
          if (b < from || a > to) return null;
          const l = pct(Math.max(a, from));
          const w = pct(Math.min(b, to)) - l;
          return (
            <div
              key={i}
              className="absolute top-3 bottom-3"
              style={{ left: `${l}%`, width: `${Math.max(0.15, w)}%`, background: "var(--accent-2)", opacity: 0.55 }}
            />
          );
        })}
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(t)}%`, background: "var(--line)" }} />
        ))}
        {current !== null && current >= from && current <= to && (
          <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${pct(current)}%`, background: "var(--accent)" }} />
        )}
        {hover !== null && (
          <div className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(hover)}%`, background: "#fff", opacity: 0.7 }} />
        )}
      </div>
    </div>
  );
}
