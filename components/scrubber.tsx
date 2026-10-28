"use client";

import { useRef, useState, type PointerEvent } from "react";
import { fmtClock } from "@/lib/time";

type Range = [number, number];

/** Zoom levels of the bar. "All" is the whole buffer (four hours: ~40 s per
 *  pixel on a phone); the others follow the playhead so a finger can land on
 *  a single rally (1 m: ~0.16 s per pixel). */
const SPANS: { label: string; ms: number | null }[] = [
  { label: "All", ms: null },
  { label: "30m", ms: 30 * 60_000 },
  { label: "5m", ms: 5 * 60_000 },
  { label: "1m", ms: 60_000 },
];

function tickStep(span: number): number {
  if (span > 3 * 3600_000) return 30 * 60_000;
  if (span > 90 * 60_000) return 15 * 60_000;
  if (span > 20 * 60_000) return 5 * 60_000;
  if (span > 4 * 60_000) return 60_000;
  if (span > 90_000) return 15_000;
  return 10_000;
}

/** The replay timeline, YouTube style: the whole recording on one bar, drag
 *  to look around (the video follows), release to stay there. Green =
 *  recorded, pale = already downloaded. */
export function Scrubber({
  from,
  to,
  ranges,
  buffered,
  current,
  marks = [],
  activeMark = null,
  window: reviewWindow = null,
  onScrubStart,
  onScrub,
  onCommit,
}: {
  from: number;
  to: number;
  ranges: Range[];
  buffered: Range[];
  current: number | null;
  /** Incidents marked in the console (wall ms) and the selected one. */
  marks?: number[];
  activeMark?: number | null;
  /** The stretch a VAR review is looping or rocking over. */
  window?: Range | null;
  onScrubStart: () => void;
  onScrub: (ms: number) => void;
  onCommit: (ms: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<number | null>(null);
  /** Start of the zoomed view, set when zooming or after a drag; playback
   *  pages it along in quarter steps so the playhead never runs off. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ ms: number; vFrom: number; vTo: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const full = Math.max(1, to - from);
  const s = span !== null && span < full ? span : full;
  const zoomed = s < full;
  const selected = zoomed ? s : null;

  const viewFor = (cur: number | null, base: number | null): [number, number] => {
    if (!zoomed) return [from, to];
    const c = cur ?? to;
    let v = base ?? c - s / 2;
    if (c < v || c > v + s) {
      const step = s / 4;
      v = v + Math.round((c - s / 2 - v) / step) * step;
    }
    v = Math.min(Math.max(from, v), to - s);
    return [v, v + s];
  };
  const [vFrom, vTo] = drag ? [drag.vFrom, drag.vTo] : viewFor(current, anchor);
  const vSpan = Math.max(1, vTo - vFrom);
  const pct = (ms: number) => ((ms - vFrom) / vSpan) * 100;

  const msAt = (clientX: number, a = vFrom, b = vTo) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.min(to, Math.max(from, a + f * (b - a)));
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    track.current?.setPointerCapture(e.pointerId);
    const ms = msAt(e.clientX);
    setDrag({ ms, vFrom, vTo });
    onScrubStart();
    onScrub(ms);
  };
  const move = (e: PointerEvent) => {
    if (drag) {
      const ms = msAt(e.clientX, drag.vFrom, drag.vTo);
      setDrag({ ...drag, ms });
      onScrub(ms);
    } else if (e.pointerType === "mouse") {
      setHover(msAt(e.clientX));
    }
  };
  const end = (e: PointerEvent) => {
    if (!drag) return;
    const ms = msAt(e.clientX, drag.vFrom, drag.vTo);
    // keep the view where the finger was, so the bar does not jump under it
    setAnchor(drag.vFrom);
    setDrag(null);
    if (e.pointerType !== "mouse") setHover(null);
    onCommit(ms);
  };

  const chooseSpan = (ms: number | null) => {
    setSpan(ms);
    setAnchor(null);
  };

  const ticks: number[] = [];
  const step = tickStep(vSpan);
  for (let t = Math.ceil(vFrom / step) * step; t < vTo; t += step) ticks.push(t);

  const shown = drag?.ms ?? hover;
  const head = drag?.ms ?? current;
  const clip = (r: Range) => [Math.max(r[0], vFrom), Math.min(r[1], vTo)] as const;
  const bars = (list: Range[], key: string, background: string, opacity: number) =>
    list.map((r, i) => {
      const [a, b] = clip(r);
      if (b <= a) return null;
      return (
        <div
          key={`${key}${i}`}
          className="absolute top-3 bottom-3"
          style={{ left: `${pct(a)}%`, width: `${Math.max(0.3, pct(b) - pct(a))}%`, background, opacity }}
        />
      );
    });

  return (
    <div className="space-y-1 select-none">
      <div className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>
        <span className="tabular-nums">{fmtClock(vFrom)}</span>
        <div className="flex-1 flex justify-center gap-1 min-w-0">
          {SPANS.filter((z) => z.ms === null || z.ms < full).map((z) => (
            <button
              key={z.label}
              onClick={() => chooseSpan(z.ms)}
              className="seg !min-h-8 short:!min-h-7 !text-xs px-2 !rounded-full whitespace-nowrap"
              aria-pressed={z.ms === selected}
            >
              {z.label}
            </button>
          ))}
        </div>
        <span className="tabular-nums">{fmtClock(vTo)}</span>
      </div>

      {zoomed && (
        // where the zoomed view sits inside the whole buffer
        <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "var(--panel-2)" }}>
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: `${((vFrom - from) / full) * 100}%`,
              width: `${Math.max(1, (vSpan / full) * 100)}%`,
              background: "var(--accent)",
              opacity: 0.7,
            }}
          />
        </div>
      )}

      <div className="relative">
        {shown !== null && (
          // the time under the finger, above the bar so the finger does not hide it
          <div
            className="absolute -top-7 z-10 px-2 py-0.5 rounded text-xs font-semibold tabular-nums pointer-events-none whitespace-nowrap"
            style={{
              left: `min(max(${pct(shown)}%, 2.2rem), calc(100% - 2.2rem))`,
              transform: "translateX(-50%)",
              background: "var(--accent)",
              color: "var(--on-accent)",
            }}
          >
            {fmtClock(shown)}
          </div>
        )}
        <div
          ref={track}
          role="slider"
          aria-label="replay position"
          aria-valuemin={from}
          aria-valuemax={to}
          aria-valuenow={head ?? undefined}
          aria-valuetext={head !== null ? fmtClock(head) : undefined}
          className="relative h-11 sm:h-12 short:!h-9 rounded-lg overflow-hidden touch-none cursor-pointer"
          style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={() => !drag && setHover(null)}
        >
          {/* recorded: the club's green; downloaded: lime over it */}
          {bars(ranges, "r", "#2f7a47", 0.75)}
          {bars(buffered, "b", "var(--accent)", 0.35)}
          {reviewWindow && (() => {
            const [a, b] = clip(reviewWindow);
            return b > a ? (
              <div
                className="absolute top-0 bottom-0 review-window"
                style={{ left: `${pct(a)}%`, width: `${Math.max(0.6, pct(b) - pct(a))}%` }}
              />
            ) : null;
          })()}
          {ticks.map((t) => (
            <div key={t} className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(t)}%`, background: "var(--line)" }} />
          ))}
          {head !== null && head >= vFrom && head <= vTo && (
            <>
              <div className="absolute top-0 bottom-0 w-0.5 -ml-px" style={{ left: `${pct(head)}%`, background: "var(--accent)" }} />
              <div
                className="absolute top-1/2 w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full"
                style={{ left: `${pct(head)}%`, background: "var(--accent)", boxShadow: "0 0 0 2px var(--bg), 0 0 12px rgba(206, 255, 101, 0.7)" }}
              />
            </>
          )}
          {marks
            .filter((m) => m >= vFrom && m <= vTo)
            .map((m) => (
              <div key={m} className={`mark-flag ${m === activeMark ? "is-active" : ""}`} style={{ left: `${pct(m)}%` }} />
            ))}
          {hover !== null && !drag && (
            <div className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(hover)}%`, background: "#fff", opacity: 0.6 }} />
          )}
        </div>
      </div>
    </div>
  );
}
