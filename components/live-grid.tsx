"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, History } from "lucide-react";
import type Hls from "hls.js";
import type { CourtConfig } from "@/lib/types";
import { ZoomPan } from "./zoom-pan";
import { BallLoader } from "./brand";

/** Live view over the proxied HLS stream. Safari plays HLS natively;
 *  everyone else gets hls.js. Latency is a few seconds; the point of the
 *  product is replay, and the live tile is there to confirm the cameras are up. */
export function HlsPlayer({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: Hls | undefined;
    let cancelled = false;

    (async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        await video.play().catch(() => {});
        return;
      }
      const { default: HlsCtor } = await import("hls.js");
      if (cancelled) return;
      if (!HlsCtor.isSupported()) {
        setErr("This browser cannot play the live stream.");
        return;
      }
      hls = new HlsCtor({ lowLatencyMode: true, liveSyncDurationCount: 3, backBufferLength: 30 });
      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (data.fatal) setErr(`${data.type}: ${data.details}`);
      });
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => {});
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  return (
    <div className="relative w-full h-full">
      <video
        ref={ref}
        muted
        playsInline
        autoPlay
        onPlaying={() => setPlaying(true)}
        className={className ?? "w-full h-full object-contain bg-black"}
      />
      {!playing && !err && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <BallLoader label="Connecting" className="scale-75" />
        </div>
      )}
      {err && (
        <div className="absolute inset-0 grid place-items-center text-sm bg-black/60 p-4 text-center" style={{ color: "var(--danger-text)" }}>
          {err}
        </div>
      )}
    </div>
  );
}

/** Same tiling as the replay page: two side by side (stacked in portrait),
 *  then 2 x 2, then 3 x 2. */
function liveGridFor(n: number): string {
  if (n <= 1) return "grid-cols-1 grid-rows-1";
  if (n === 2) return "portrait:grid-rows-2 portrait:grid-cols-1 landscape:grid-cols-2 landscape:grid-rows-1";
  if (n <= 4) return "grid-cols-2 grid-rows-2";
  return "portrait:grid-cols-2 portrait:grid-rows-3 landscape:grid-cols-3 landscape:grid-rows-2";
}

export function LiveGrid({ court }: { court: CourtConfig }) {
  return (
    <div className="flex flex-col overflow-y-auto fade" style={{ height: "calc(100dvh - var(--app-header))" }}>
      <div className="shrink-0 flex items-center gap-2 px-2 sm:px-3 py-1.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <Link href="/courts" className="grid place-items-center h-9 w-9 rounded-full muted hover:!text-[var(--accent)]" aria-label="back to courts">
          <ChevronLeft className="icon" aria-hidden />
        </Link>
        <h1 className="display text-2xl sm:text-[1.7rem] pt-0.5 truncate min-w-0">{court.name}</h1>
        <span className="pill pill-live">
          <span className="dot live" />
          Live
        </span>
        <Link href={`/courts/${court.slug}`} className="btn btn-accent ml-auto !min-h-10 text-sm">
          <History className="icon" aria-hidden />
          Replay
        </Link>
      </div>
      <div className={`flex-1 grid gap-1 p-1 ${liveGridFor(court.cameras.length)}`} style={{ minHeight: "clamp(200px, 45dvh, 520px)" }}>
        {court.cameras.map((cam) => (
          <div
            key={cam.path}
            className="relative min-h-0 rounded-lg overflow-hidden"
            style={{ background: "#000", border: "1px solid var(--line)" }}
          >
            <ZoomPan className="w-full h-full">
              <HlsPlayer src={`/api/video/hls/${encodeURIComponent(cam.path)}/index.m3u8`} />
            </ZoomPan>
            <div className="absolute left-2 top-2 tile-label pointer-events-none">
              {cam.label}
            </div>
          </div>
        ))}
      </div>
      <p
        className="shrink-0 text-xs px-3 py-1.5 muted"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        Live runs a few seconds behind the court. For anything disputed, use replay.
      </p>
    </div>
  );
}
