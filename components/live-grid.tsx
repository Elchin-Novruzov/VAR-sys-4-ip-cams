"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, History, RotateCcw } from "lucide-react";
import type Hls from "hls.js";
import type { CourtConfig } from "@/lib/types";
import { ZoomPan } from "./zoom-pan";
import { BallLoader } from "./brand";

/** What the live grid needs from each tile to keep the cameras in step:
 *  its video, and an estimate of when the frame on screen reached the server. */
export type LiveClock = { video: HTMLVideoElement; frameDate: () => number | null };

/** Live sync: each player starts wherever its first playlist put it, and
 *  stalls push it further back, so the tiles drift apart by up to a few
 *  seconds. MediaMTX cuts every camera's live segments as the frames arrive,
 *  so a player's distance behind its own live edge (hls.js `latency`: edge +
 *  playlist age − position) dates the frame on screen in server-arrival time;
 *  the camera's Align offset is added on top. MediaMTX's playlists carry no
 *  PROGRAM-DATE-TIME (checked 2026-10-28), so this is the clock there is.
 *  Pictures ahead of the slowest one slow down a little until they show the
 *  same moment; one more than 2.5 s ahead jumps back. */
const SYNC_EVERY_MS = 500;
/** Reads as "In sync" up to this spread; the easing starts well below it. */
const SYNC_OK_MS = 120;
const SYNC_EASE_MS = 40;
const SYNC_JUMP_MS = 2500;

/** Live view over the proxied HLS stream: hls.js, or the browser's own HLS
 *  where there is no Media Source (older iPhones). Latency is a few seconds;
 *  the point of the product is replay, and the live tile is there to confirm
 *  the cameras are up. */
export function HlsPlayer({
  src,
  className,
  onClock,
}: {
  src: string;
  className?: string;
  /** Hands the live grid this tile's clock (null when the player goes). */
  onClock?: (clock: LiveClock | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const clockTo = useRef(onClock);
  useEffect(() => {
    clockTo.current = onClock;
  });

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: Hls | undefined;
    let cancelled = false;

    const frameDate = (): number | null => {
      let behind: number;
      if (hls) behind = hls.latency;
      else {
        // Safari's own HLS: the distance from the end of the seekable range
        const r = video.seekable;
        if (!r.length) return null;
        behind = r.end(r.length - 1) - video.currentTime;
      }
      return Number.isFinite(behind) && behind > 0 ? Date.now() - behind * 1000 : null;
    };
    clockTo.current?.({ video, frameDate });

    (async () => {
      // hls.js first, as on the replay page: Chrome now answers "maybe" for
      // HLS too, and its own player left the second camera at a black tile
      // with MediaMTX's low-latency playlists (2026-10-28). The browser's
      // own HLS is for the phones without Media Source (older iPhones).
      const { default: HlsCtor } = await import("hls.js");
      if (cancelled) return;
      if (!HlsCtor.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
          await video.play().catch(() => {});
        } else setErr("This browser cannot play the live stream.");
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
      clockTo.current?.(null);
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
  const clocks = useRef<Record<string, LiveClock>>({});
  /** Spread between the tiles' pictures (ms), null while fewer than two play
   *  or the streams carry no dates. */
  const [spread, setSpread] = useState<number | null>(null);

  useEffect(() => {
    // browser tests (and ?debug on any build) can read the tiles' clocks
    if (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as { __live: unknown }).__live = clocks.current;
    }
    let offsets: Record<string, number> = {};
    const loadOffsets = async () => {
      try {
        const res = await fetch(`/api/replay/state?court=${encodeURIComponent(court.slug)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { cameras: Record<string, { offsetMs?: number }> };
        offsets = Object.fromEntries(Object.entries(data.cameras).map(([k, v]) => [k, v.offsetMs ?? 0]));
      } catch {
        // keep the last known offsets
      }
    };
    void loadOffsets();
    const reload = setInterval(() => void loadOffsets(), 30_000);

    const sync = setInterval(() => {
      if (document.hidden) return;
      const tiles = Object.entries(clocks.current)
        .map(([path, c]) => {
          const d = c.frameDate();
          return { v: c.video, at: d === null ? null : d + (offsets[path] ?? 0) };
        })
        .filter((t): t is { v: HTMLVideoElement; at: number } => t.at !== null && !t.v.paused && t.v.readyState >= 3);
      if (tiles.length < 2) {
        for (const c of Object.values(clocks.current)) if (c.video.playbackRate !== 1) c.video.playbackRate = 1;
        setSpread(null);
        return;
      }
      const slowest = Math.min(...tiles.map((t) => t.at));
      let worst = 0;
      for (const t of tiles) {
        const ahead = t.at - slowest;
        worst = Math.max(worst, ahead);
        if (ahead > SYNC_JUMP_MS) {
          t.v.currentTime = Math.max(0, t.v.currentTime - ahead / 1000);
          t.v.playbackRate = 1;
        } else if (ahead > SYNC_EASE_MS) {
          t.v.playbackRate = Math.max(0.8, 1 - ahead / 2000);
        } else if (t.v.playbackRate !== 1) {
          t.v.playbackRate = 1;
        }
      }
      // round, so the header re-renders only when the reading changes
      const shown = Math.round(worst / 20) * 20;
      setSpread((s) => (s === shown ? s : shown));
    }, SYNC_EVERY_MS);

    return () => {
      clearInterval(reload);
      clearInterval(sync);
    };
  }, [court.slug]);

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
        {spread !== null && (
          <span
            className={`pill tabular-nums ${spread <= SYNC_OK_MS ? "pill-ok" : "pill-quiet"}`}
            title="The cameras are held on the same moment (the time each frame reached the server, with the Align offsets)"
          >
            {spread <= SYNC_OK_MS ? "In sync" : `Syncing ${(spread / 1000).toFixed(1)} s`}
          </span>
        )}
        <Link href={`/courts/${court.slug}`} className="btn btn-accent ml-auto !min-h-10 text-sm">
          <History className="icon" aria-hidden />
          <span className="hidden sm:inline">Replay</span>
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
              <HlsPlayer
                src={`/api/video/hls/${encodeURIComponent(cam.path)}/index.m3u8`}
                onClock={(c) => {
                  if (c) clocks.current[cam.path] = c;
                  else delete clocks.current[cam.path];
                }}
              />
            </ZoomPan>
            <div className="absolute left-2 top-2 tile-label pointer-events-none">{cam.label}</div>
          </div>
        ))}
      </div>
      {/* instant replay: open the replay that far back, already playing */}
      <div
        className="shrink-0 px-2 sm:px-3 pt-2 space-y-1.5"
        style={{
          borderTop: "1px solid var(--line)",
          background: "var(--panel)",
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="eyebrow hidden sm:inline pr-1">Instant replay</span>
          {[10, 30, 60].map((s) => (
            <Link key={s} href={`/courts/${court.slug}?back=${s}`} className="btn btn-accent flex-1 sm:flex-none !min-h-11">
              <RotateCcw className="icon" aria-hidden />
              {s} s
            </Link>
          ))}
        </div>
        <p className="text-xs muted">Live runs a few seconds behind the court. For anything disputed, use replay.</p>
      </div>
    </div>
  );
}
