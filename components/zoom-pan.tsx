"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

type T = { s: number; x: number; y: number };
const MAX = 8;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;

/** Wheel / pinch to zoom, drag to pan, double-tap or double-click to zoom in
 *  and reset. Pure CSS transform on the child, so it works on a `<video>`
 *  without touching the decoder.
 *
 *  Touch behaviour: while unzoomed, a single finger is left to the page (so
 *  a stacked layout on a phone can still scroll) and two fingers pinch; once
 *  zoomed, a single finger pans the picture. */
export function ZoomPan({ children, className = "" }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<T>({ s: 1, x: 0, y: 0 });
  // Pointer handlers need the latest transform without re-binding on every
  // render; the ref is synced after commit, which is before any next event.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; s: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const touchDoubleAt = useRef(0);

  const clamp = (s: number, x: number, y: number): T => {
    const el = box.current;
    s = Math.min(MAX, Math.max(1, s));
    if (!el || s === 1) return { s: 1, x: 0, y: 0 };
    const w = el.clientWidth;
    const h = el.clientHeight;
    return { s, x: Math.min(0, Math.max(w - w * s, x)), y: Math.min(0, Math.max(h - h * s, y)) };
  };

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const p = tRef.current;
    const s = Math.min(MAX, Math.max(1, p.s * factor));
    const k = s / p.s;
    setT(clamp(s, cx - k * (cx - p.x), cy - k * (cy - p.y)));
  };

  const toggleZoomAt = (x: number, y: number) => {
    if (tRef.current.s > 1) setT({ s: 1, x: 0, y: 0 });
    else zoomAt(2.5, x, y);
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Wheel: a plain wheel scrolls the page like anywhere else. Zoom needs
  // Ctrl (or Cmd) held, which is also how browsers deliver a trackpad pinch.
  // Native, non-passive listener so preventDefault works when we do zoom.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const { x, y } = local(e);
      zoomAt(Math.exp(-e.deltaY * 0.005), x, y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomCenter = (factor: number) => {
    const el = box.current;
    if (!el) return;
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const p = local(e);

    // double-tap on touch: browsers do not reliably send dblclick for touches
    if (e.pointerType === "touch" && pts.current.size === 0) {
      const last = lastTap.current;
      const now = performance.now();
      if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < DOUBLE_TAP_PX) {
        lastTap.current = null;
        touchDoubleAt.current = now;
        toggleZoomAt(p.x, p.y);
        return;
      }
      lastTap.current = { at: now, x: p.x, y: p.y };
    }

    box.current?.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, p);
    if (pts.current.size === 1) {
      drag.current = { px: p.x, py: p.y, x: tRef.current.x, y: tRef.current.y };
    } else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s: tRef.current.s,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        x: tRef.current.x,
        y: tRef.current.y,
      };
      drag.current = null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    const p = local(e);
    pts.current.set(e.pointerId, p);
    if (pts.current.size === 2 && pinch.current) {
      const [a, b] = [...pts.current.values()];
      const g = pinch.current;
      const s = Math.min(MAX, Math.max(1, (g.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      const k = s / g.s;
      setT(clamp(s, g.cx - k * (g.cx - g.x), g.cy - k * (g.cy - g.y)));
    } else if (pts.current.size === 1 && drag.current && tRef.current.s > 1) {
      const d = drag.current;
      setT(clamp(tRef.current.s, d.x + (p.x - d.px), d.y + (p.y - d.py)));
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    if (pts.current.size === 0) drag.current = null;
    else if (pts.current.size === 1) {
      const [p] = [...pts.current.values()];
      drag.current = { px: p.x, py: p.y, x: tRef.current.x, y: tRef.current.y };
    }
  };

  const onDoubleClick = (e: MouseEvent) => {
    // a touch double-tap was already handled in onPointerDown
    if (performance.now() - touchDoubleAt.current < 600) return;
    const { x, y } = local(e);
    toggleZoomAt(x, y);
  };

  return (
    <div
      ref={box}
      className={"relative overflow-hidden select-none " + className}
      style={{
        cursor: t.s > 1 ? "grab" : "zoom-in",
        // unzoomed: let the page scroll on a vertical swipe; zoomed: pan
        touchAction: t.s > 1 ? "none" : "pan-y",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
          transformOrigin: "0 0",
          width: "100%",
          height: "100%",
        }}
      >
        {children}
      </div>
      {/* visible zoom controls; stop pointer events so a tap here never starts a drag */}
      <div
        className="absolute top-2 right-2 flex gap-1"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={() => zoomCenter(1 / 1.5)} disabled={t.s <= 1} className="zoom-btn" aria-label="zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => setT({ s: 1, x: 0, y: 0 })}
          className="zoom-btn tabular-nums"
          style={{ minWidth: "3.25rem" }}
          aria-label="reset zoom"
          title="reset zoom"
        >
          {t.s > 1 ? `${t.s.toFixed(1)}×` : "1×"}
        </button>
        <button type="button" onClick={() => zoomCenter(1.5)} disabled={t.s >= MAX} className="zoom-btn" aria-label="zoom in">
          +
        </button>
      </div>
    </div>
  );
}
