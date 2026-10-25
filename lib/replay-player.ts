/** One camera of the replay console: a <video> playing that camera's whole
 *  replay buffer as one HLS timeline (lib/recordings.ts serves it), plus the
 *  mapping between the video's own time and the wall clock.
 *
 *  hls.js wherever Media Source Extensions exist (desktop, Android, iPad,
 *  iPhone on iOS 17.1+ through ManagedMediaSource); the browser's own HLS
 *  player on an older iPhone. `?engine=native` or `?engine=hls` on the page
 *  URL forces one for testing.
 *
 *  Browser only: import it from client components. */

import type Hls from "hls.js";
import type { ErrorData, Fragment, HlsConfig } from "hls.js";

export type Engine = "hls" | "native";
export type WallRange = [number, number];

/** Seconds of video kept ahead of the playhead. Small while paused: a VAR
 *  user jumps around, and every jump would otherwise start a 20 s download. */
const AHEAD_PLAYING = 10;
const AHEAD_PAUSED = 4;

export function playlistUrl(camera: string, epoch: string) {
  return `/api/replay/${encodeURIComponent(camera)}/index.m3u8?e=${encodeURIComponent(epoch)}`;
}

let hlsModule: Promise<typeof import("hls.js")> | null = null;
function loadHls() {
  return (hlsModule ??= import("hls.js"));
}

export async function pickEngine(): Promise<Engine | null> {
  const forced = new URLSearchParams(window.location.search).get("engine");
  if (forced === "native" || forced === "hls") return forced;
  const { default: H } = await loadHls();
  if (H.isSupported()) return "hls";
  if (document.createElement("video").canPlayType("application/vnd.apple.mpegurl")) return "native";
  return null;
}

export type PlayerCallbacks = {
  /** The playlist changed (new segments at the live edge, or the first load). */
  onUpdate: () => void;
  /** Unrecoverable: the console starts a fresh player at the same moment. */
  onFatal: (why: string) => void;
};

/** Index of the last element for which `ok` holds, in an array sorted so
 *  that `ok` is true for a prefix. -1 when none. */
function lastWhere<T>(a: readonly T[], ok: (x: T) => boolean): number {
  let lo = 0;
  let hi = a.length - 1;
  let k = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (ok(a[m])) {
      k = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return k;
}

export class CameraPlayer {
  hls: Hls | null = null;
  /** Presentation time of the frame on screen (requestVideoFrameCallback),
   *  for exact frame steps. */
  frameTime: number | null = null;
  private disposed = false;
  private pending: number | null = null;
  private inflight: number | null = null;
  private loading = true;
  private rangesCache: { key: unknown; off: number; ranges: WallRange[] } | null = null;
  /** This camera's clock correction (ms, lib/offsets.ts): added to every
   *  recorded time, so cameras of different systems show the same moment.
   *  Every wall-clock value this class returns or takes is on the court clock. */
  offsetMs = 0;
  /** Where the player was told to open (video time), until it is there.
   *  Before that the element sits at 0 -- the oldest moment of the buffer --
   *  and must not be taken for the position on screen. */
  private openAt: number | null = null;
  private positioned = false;
  private recoveries: number[] = [];

  constructor(
    readonly camera: string,
    readonly epoch: string,
    readonly video: HTMLVideoElement,
    readonly engine: Engine,
    private cb: PlayerCallbacks,
  ) {
    video.addEventListener("seeked", this.onSeeked);
    this.watchFrames();
  }

  /** Starts loading. `startWall` = the moment to open at (ms), or null for
   *  `fallbackLead` seconds behind the newest recorded moment. */
  async start(startWall: number | null, fallbackLead: number, playing: boolean) {
    try {
      await this.startInner(startWall, fallbackLead, playing);
    } catch (e) {
      if (!this.disposed) this.cb.onFatal((e as Error).message);
    }
  }

  private async startInner(startWall: number | null, fallbackLead: number, playing: boolean) {
    const url = playlistUrl(this.camera, this.epoch);
    if (this.engine === "native") {
      this.video.src = url;
      this.video.addEventListener(
        "loadedmetadata",
        () => {
          if (this.disposed) return;
          const t = (startWall !== null ? this.timeAt(startWall, true) : null) ?? this.fallbackStart(fallbackLead);
          if (t !== null) this.video.currentTime = t;
          this.positioned = true;
          this.cb.onUpdate();
        },
        { once: true },
      );
      this.video.addEventListener("error", () => !this.disposed && this.cb.onFatal("the browser stopped the stream"));
      return;
    }

    const { default: H } = await loadHls();
    if (this.disposed) return;
    const config: Partial<HlsConfig> = {
      autoStartLoad: false,
      // not progressive: hls.js 1.7 copies a half-parsed segment's duration
      // into the refreshed live playlist and the timeline drifts (measured)
      progressive: false,
      lowLatencyMode: false,
      backBufferLength: 60,
      maxBufferLength: playing ? AHEAD_PLAYING : AHEAD_PAUSED,
      maxMaxBufferLength: 40,
      maxBufferSize: 60 * 1000 * 1000,
      // a replay tool never speeds up to catch the live edge (and hls.js's
      // default liveMaxLatencyDurationCount, Infinity, never jumps there)
      maxLiveSyncPlaybackRate: 1,
      liveDurationInfinity: false,
      startFragPrefetch: false,
      testBandwidth: false,
      capLevelToPlayerSize: false,
      enableWorker: true,
    };
    const hls = new H(config);
    this.hls = hls;
    let started = false;
    const onDetails = () => {
      if (this.disposed) return;
      this.rangesCache = null;
      if (!started) {
        started = true;
        const t = (startWall !== null ? this.timeAt(startWall, true) : null) ?? this.fallbackStart(fallbackLead) ?? -1;
        this.openAt = t >= 0 ? t : null;
        hls.startLoad(t);
        this.loading = true;
      }
      this.cb.onUpdate();
    };
    hls.on(H.Events.LEVEL_LOADED, onDetails);
    hls.on(H.Events.LEVEL_UPDATED, onDetails);
    hls.on(H.Events.ERROR, (_e, data) => this.onError(H, data));
    hls.attachMedia(this.video);
    hls.loadSource(url);
  }

  /** A new correction (the Align panel, or someone else's save). */
  setOffset(ms: number) {
    if (ms === this.offsetMs) return;
    this.offsetMs = ms;
    this.rangesCache = null;
  }

  destroy() {
    this.disposed = true;
    this.video.removeEventListener("seeked", this.onSeeked);
    this.hls?.destroy();
    this.hls = null;
    if (this.engine === "native" || this.video.getAttribute("src")) {
      this.video.removeAttribute("src");
      this.video.load();
    }
  }

  private onError(H: typeof Hls, data: ErrorData) {
    if (this.disposed) return;
    const code = (data.response as { code?: number } | undefined)?.code;
    if (code === 410) {
      // the server restarted and renumbered its segments
      this.cb.onFatal("restarted");
      return;
    }
    if (!data.fatal) return;
    if (data.type === H.ErrorTypes.MEDIA_ERROR) {
      // a decode hiccup: hls.js can rebuild the decoder in place, but not
      // for ever (a codec this device cannot play would loop)
      const now = Date.now();
      this.recoveries = this.recoveries.filter((t) => now - t < 10_000);
      if (this.recoveries.length < 2) {
        this.recoveries.push(now);
        this.hls?.recoverMediaError();
        return;
      }
    }
    this.cb.onFatal(data.details);
  }

  // ------------------------------------------------------------- timeline

  private fragments(): Fragment[] {
    const d = this.hls?.levels?.[0]?.details;
    return (d?.fragments as Fragment[] | undefined) ?? [];
  }

  private startDate(): number | null {
    const sd = (this.video as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate?.();
    const ms = sd ? sd.getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
  }

  /** Wall clock (ms) of video time `t`, or null before the playlist loads. */
  wallAt(t: number): number | null {
    if (this.engine === "native") {
      const d = this.startDate();
      return d === null ? null : d + t * 1000 + this.offsetMs;
    }
    const fs = this.fragments();
    const i = lastWhere(fs, (f) => f.start <= t + 1e-4);
    if (i < 0) return null;
    const f = fs[i];
    if (f.programDateTime === null) return null;
    return f.programDateTime + (t - f.start) * 1000 + this.offsetMs;
  }

  /** Video time showing wall-clock moment `ms`. Null when this camera
   *  recorded nothing then; with `snap`, the next moment it did record. */
  timeAt(ms: number, snap = false): number | null {
    ms -= this.offsetMs; // court clock -> this camera's recorded clock
    if (this.engine === "native") {
      const d = this.startDate();
      if (d === null) return null;
      const t = (ms - d) / 1000;
      const s = this.video.seekable;
      if (!s.length) return t;
      if (t < s.start(0)) return snap ? s.start(0) : null;
      if (t > s.end(s.length - 1)) return snap ? s.end(s.length - 1) : null;
      return t;
    }
    const fs = this.fragments();
    if (!fs.length) return null;
    const i = lastWhere(fs, (f) => f.programDateTime !== null && f.programDateTime <= ms);
    if (i < 0) return snap ? fs[0].start : null;
    const f = fs[i];
    const into = (ms - (f.programDateTime as number)) / 1000;
    if (into <= f.duration + 0.05) return f.start + into;
    if (i + 1 < fs.length) return snap ? fs[i + 1].start : null; // in a gap
    return snap ? f.start + Math.max(0, f.duration - 0.05) : null; // past the newest frame
  }

  /** Newest recorded moment in the playlist (ms). */
  liveEdge(): number | null {
    if (this.engine === "native") {
      const s = this.video.seekable;
      return s.length ? this.wallAt(s.end(s.length - 1)) : null;
    }
    const fs = this.fragments();
    const f = fs[fs.length - 1];
    return f && f.programDateTime !== null ? f.programDateTime + f.duration * 1000 + this.offsetMs : null;
  }

  /** Recorded spans (ms) according to the playlist. */
  ranges(): WallRange[] {
    if (this.engine === "native") {
      const s = this.video.seekable;
      const out: WallRange[] = [];
      for (let i = 0; i < s.length; i++) {
        const a = this.wallAt(s.start(i));
        const b = this.wallAt(s.end(i));
        if (a !== null && b !== null) out.push([a, b]);
      }
      return out;
    }
    const d = this.hls?.levels?.[0]?.details;
    if (this.rangesCache && this.rangesCache.key === d && this.rangesCache.off === this.offsetMs) {
      return this.rangesCache.ranges;
    }
    const out: WallRange[] = [];
    for (const f of this.fragments()) {
      if (f.programDateTime === null) continue;
      const a = f.programDateTime + this.offsetMs;
      const b = a + f.duration * 1000;
      const last = out[out.length - 1];
      if (last && a - last[1] < 1000) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    this.rangesCache = { key: d, off: this.offsetMs, ranges: out };
    return out;
  }

  /** What is already downloaded, as wall-clock spans. */
  buffered(): WallRange[] {
    const b = this.video.buffered;
    const out: WallRange[] = [];
    for (let i = 0; i < b.length; i++) {
      const a = this.wallAt(b.start(i));
      const e = this.wallAt(b.end(i));
      if (a !== null && e !== null) out.push([a, e]);
    }
    return out;
  }

  wallNow(): number | null {
    const v = this.video;
    if (v.readyState < 1) return null;
    if (!this.positioned) {
      if (this.openAt !== null && Math.abs(v.currentTime - this.openAt) > 3) return null;
      this.positioned = true;
    }
    return this.wallAt(v.currentTime);
  }

  /** Where an unfinished seek is heading, or null. */
  seekingTo(): number | null {
    return this.video.seeking ? (this.pending ?? this.inflight) : null;
  }

  isBuffered(t: number): boolean {
    const b = this.video.buffered;
    for (let i = 0; i < b.length; i++) if (t >= b.start(i) - 0.02 && t <= b.end(i) + 0.02) return true;
    return false;
  }

  // -------------------------------------------------------------- control

  /** Seeks without piling seeks up: while a seek into downloaded video is
   *  decoding, only the newest target waits. A seek into video that is not
   *  downloaded yet drops whatever is downloading and starts at the target
   *  (hls.js by itself only drops a download when seeking forward past it,
   *  so rolling back used to wait for the old position's segment first). */
  seek(t: number, abort = true) {
    const v = this.video;
    if (v.seeking && this.inflight !== null && this.isBuffered(this.inflight)) {
      this.pending = t;
      return;
    }
    this.pending = null;
    this.inflight = t;
    this.positioned = true;
    // (a follower catching up passes abort=false: dropping its own download
    // every time it falls behind would keep it behind for ever)
    if (abort && this.hls && this.loading && !this.isBuffered(t)) {
      this.hls.stopLoad();
      this.hls.startLoad(t);
    }
    v.currentTime = t;
  }

  private onSeeked = () => {
    this.inflight = null;
    if (this.pending !== null) {
      const p = this.pending;
      this.pending = null;
      this.seek(p, false);
    }
  };

  /** How far ahead to download: generous while playing, little while paused. */
  setPlaying(playing: boolean) {
    if (this.hls) (this.hls.config as HlsConfig).maxBufferLength = playing ? AHEAD_PLAYING : AHEAD_PAUSED;
  }

  /** Stops / resumes downloading (hidden tile, background tab, a follower
   *  waiting for the leading camera). `at` = where to resume. */
  setLoading(on: boolean, at?: number) {
    if (!this.hls || on === this.loading) return;
    this.loading = on;
    if (on) this.hls.startLoad(at ?? (this.video.currentTime || -1));
    else this.hls.stopLoad();
  }

  isLoading(): boolean {
    return this.loading;
  }

  /** The server closed this playlist (the camera stopped streaming): hls.js
   *  no longer reloads it, so new recordings need a fresh player. */
  ended(): boolean {
    const d = this.hls?.levels?.[0]?.details;
    return !!d && !d.live;
  }

  private fallbackStart(leadSec: number): number | null {
    if (this.engine === "native") {
      const s = this.video.seekable;
      return s.length ? Math.max(s.start(0), s.end(s.length - 1) - leadSec) : null;
    }
    const fs = this.fragments();
    if (!fs.length) return null;
    const last = fs[fs.length - 1];
    return Math.max(fs[0].start, last.start + last.duration - leadSec);
  }

  private watchFrames() {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    };
    if (!v.requestVideoFrameCallback) return;
    const loop = (_now: number, meta: { mediaTime: number }) => {
      if (this.disposed) return;
      this.frameTime = meta.mediaTime;
      v.requestVideoFrameCallback!(loop);
    };
    v.requestVideoFrameCallback(loop);
  }
}
