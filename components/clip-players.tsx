"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { SerializedClip } from "@/lib/types";
import { fmtBytes, fmtDateTime, fmtDuration } from "@/lib/time";
import { ZoomPan } from "./zoom-pan";

/** Plays a saved clip, all cameras together, with the same slow-motion and
 *  zoom as the live console. Used by the private clip page and the public
 *  share page; only the file URL base differs. A plain string prop, not a
 *  function: server components cannot pass functions to a client component. */
export function ClipPlayers({
  clip,
  fileBase,
  showShare = false,
}: {
  clip: SerializedClip;
  fileBase: string;
  showShare?: boolean;
}) {
  const fileUrl = (camera: string) => `${fileBase}?camera=${encodeURIComponent(camera)}`;
  const refs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [rate, setRate] = useState(1);
  const [copied, setCopied] = useState(false);
  // The page origin is browser-only; on the server it renders empty and the
  // client fills it in without a setState-in-effect.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  const all = () => Object.values(refs.current).filter((v): v is HTMLVideoElement => !!v);
  const playAll = () => {
    const [m] = all();
    for (const v of all()) {
      if (m) v.currentTime = m.currentTime;
      v.playbackRate = rate;
      void v.play();
    }
  };
  const pauseAll = () => all().forEach((v) => v.pause());
  const restart = () => {
    for (const v of all()) {
      v.pause();
      v.currentTime = 0;
    }
  };
  const changeRate = (r: number) => {
    setRate(r);
    all().forEach((v) => (v.playbackRate = r));
  };

  const shareUrl = `${origin}/share/${clip.shareToken}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", shareUrl);
    }
  };

  return (
    <div className="p-2 sm:p-4 space-y-3">
      <div>
        <h1 className="text-lg font-semibold">{clip.label}</h1>
        {/* local time differs between the server and the viewer's browser */}
        <p className="text-sm" style={{ color: "var(--muted)" }} suppressHydrationWarning>
          {fmtDateTime(new Date(clip.start).getTime())} · {fmtDuration(clip.durationSec)} · {clip.courtSlug}
        </p>
      </div>
      <div className="grid gap-2 grid-cols-1 landscape:grid-cols-2">
        {clip.cameras.map((cam) => (
          <div
            key={cam.path}
            className="relative aspect-video rounded-xl overflow-hidden"
            style={{ background: "#000", border: "1px solid var(--line)" }}
          >
            <ZoomPan className="w-full h-full">
              <video
                ref={(el) => {
                  refs.current[cam.path] = el;
                }}
                src={fileUrl(cam.path)}
                muted
                playsInline
                preload="auto"
                controls
                className="w-full h-full object-contain"
              />
            </ZoomPan>
            <div className="absolute left-2 top-2 text-xs px-2 py-1 rounded bg-black/60 pointer-events-none">
              {cam.label} · {fmtBytes(cam.bytes)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={restart}>⟲ Start</button>
        <button onClick={playAll} className="font-semibold" style={{ background: "var(--panel-2)" }}>
          Play both
        </button>
        <button onClick={pauseAll}>Pause</button>
        <div className="flex gap-1">
          {[1, 0.5, 0.25, 0.1].map((s) => (
            <button
              key={s}
              onClick={() => changeRate(s)}
              className="text-sm"
              style={{ background: rate === s ? "var(--accent)" : undefined, color: rate === s ? "#06202b" : undefined }}
            >
              {s}×
            </button>
          ))}
        </div>
        {showShare && (
          <button
            onClick={copy}
            className="ml-auto whitespace-nowrap"
            style={{ background: "var(--accent-2)", color: "#03200f", border: "none" }}
          >
            {copied ? "Link copied" : "Copy share link"}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {clip.cameras.map((cam) => (
          <a key={cam.path} href={fileUrl(cam.path)} download className="underline">
            Download {cam.label}
          </a>
        ))}
      </div>
      {showShare && origin && (
        <p className="text-xs break-all" style={{ color: "var(--muted)" }}>
          Anyone with this link can watch the clip: {shareUrl}
        </p>
      )}
    </div>
  );
}
