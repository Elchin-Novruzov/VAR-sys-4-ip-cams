"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { CourtConfig } from "@/lib/types";
import { ZoomPan } from "./zoom-pan";

/** Live view over the proxied HLS stream. Safari plays HLS natively;
 *  everyone else gets hls.js. Latency is a few seconds; the point of the
 *  product is replay, and the live tile is there to confirm the cameras are up. */
export function HlsPlayer({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);

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
      <video ref={ref} muted playsInline autoPlay className={className ?? "w-full h-full object-contain bg-black"} />
      {err && (
        <div className="absolute inset-0 grid place-items-center text-sm bg-black/60 p-4 text-center" style={{ color: "#fca5a5" }}>
          {err}
        </div>
      )}
    </div>
  );
}

export function LiveGrid({ court }: { court: CourtConfig }) {
  return (
    <div className="flex flex-col overflow-y-auto" style={{ height: "calc(100dvh - var(--app-header))" }}>
      <div className="shrink-0 flex items-center gap-2 px-2 sm:px-3 py-1.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <Link href="/courts" className="text-sm px-1" style={{ color: "var(--muted)" }} aria-label="back to courts">
          ‹
        </Link>
        <span className="font-semibold truncate min-w-0 flex-1">{court.name} · live</span>
        <Link
          href={`/courts/${court.slug}`}
          className="ml-auto px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap"
          style={{ background: "var(--accent)", color: "#06202b" }}
        >
          Replay
        </Link>
      </div>
      <div
        className="flex-1 grid gap-1 p-1 portrait:grid-rows-2 portrait:grid-cols-1 landscape:grid-cols-2 landscape:grid-rows-1"
        style={{ minHeight: "clamp(200px, 45dvh, 520px)" }}
      >
        {court.cameras.map((cam) => (
          <div
            key={cam.path}
            className="relative min-h-0 rounded-lg overflow-hidden"
            style={{ background: "#000", border: "1px solid var(--line)" }}
          >
            <ZoomPan className="w-full h-full">
              <HlsPlayer src={`/api/video/hls/${encodeURIComponent(cam.path)}/index.m3u8`} />
            </ZoomPan>
            <div className="absolute left-2 top-2 text-xs px-2 py-1 rounded bg-black/60 pointer-events-none">
              {cam.label}
            </div>
          </div>
        ))}
      </div>
      <p
        className="shrink-0 text-xs px-3 py-1.5"
        style={{ color: "var(--muted)", paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        Live runs a few seconds behind the court. For anything disputed, use replay.
      </p>
    </div>
  );
}
