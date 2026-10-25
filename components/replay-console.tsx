"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraConfig, CourtConfig } from "@/lib/types";
import { fmtClock } from "@/lib/time";
import { CameraPlayer, pickEngine, type Engine, type WallRange } from "@/lib/replay-player";
import { ZoomPan } from "./zoom-pan";
import { Scrubber } from "./scrubber";

const SPEEDS = [1, 0.5, 0.25, 0.1] as const;
/** Opening the page plays from this many seconds before the newest moment. */
const OPEN_LEAD_SEC = 30;
/** "Live" plays this far behind the newest segment, so playback never runs
 *  into the edge and stalls while the next two seconds are recorded. */
const LIVE_LAG_SEC = 6;
const STATE_EVERY_MS = 5000;
const TICK_MS = 100;
/** A tile shows its spinner only after waiting this long (no flicker on
 *  seeks inside downloaded video). */
const SPINNER_AFTER_MS = 300;
/** A follower that fell behind jumps ahead of the leader by about the time
 *  its download takes, and at most this often (no seek-chase on a slow line). */
const CATCH_UP_EVERY_MS = 1500;
const CATCH_UP_LEAD_SEC = 0.8;

type CamInfo = {
  epoch: string;
  ranges: WallRange[];
  from: number | null;
  until: number | null;
  segments: number;
  /** The camera stopped streaming; its playlist is closed. */
  ended: boolean;
  /** Clock correction for this camera (lib/offsets.ts); spans above include it. */
  offsetMs?: number;
};

type Tile = { kind: "none" | "loading" | "ok" | "gap" | "error"; msg?: string; waiting?: boolean };

type Ui = {
  wall: number | null;
  playing: boolean;
  from: number | null;
  until: number | null;
  ranges: WallRange[];
  buffered: WallRange[];
  tiles: Record<string, Tile>;
};

const EMPTY_UI: Ui = { wall: null, playing: false, from: null, until: null, ranges: [], buffered: [], tiles: {} };

/** Focus: "all", "group:<var|detector>", or one camera's path. */
function shownIn(focus: string, cam: CameraConfig): boolean {
  if (focus === "all" || focus === cam.path) return true;
  return focus.startsWith("group:") && (cam.group ?? "var") === focus.slice(6);
}

/** Cameras worth a tile: the club's cameras always (they stream around the
 *  clock), a detector camera only when it recorded something in the buffer --
 *  the detector PC is at the court a few hours a week, and four empty tiles
 *  the rest of the time would bury the two that matter. */
function isHere(cam: CameraConfig, info: Record<string, { segments: number }>): boolean {
  return (cam.group ?? "var") === "var" || (info[cam.path]?.segments ?? 0) > 0;
}

/** Grid for n tiles: side by side in landscape, stacked in portrait, and a
 *  2 x 2 / 3 x 2 grid once there are more than two. */
function gridFor(n: number): string {
  if (n <= 1) return "grid-cols-1 grid-rows-1";
  if (n === 2) return "portrait:grid-rows-2 portrait:grid-cols-1 landscape:grid-cols-2 landscape:grid-rows-1";
  if (n <= 4) return "grid-cols-2 grid-rows-2";
  return "portrait:grid-cols-2 portrait:grid-rows-3 landscape:grid-cols-3 landscape:grid-rows-2";
}

function mergeRanges(lists: WallRange[][]): WallRange[] {
  const all = lists.flat().sort((a, b) => a[0] - b[0]);
  const out: WallRange[] = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1000) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The courtside VAR screen. Each camera plays its whole replay buffer as
 *  one HLS timeline (lib/replay-player.ts over lib/recordings.ts), so the
 *  bar covers the full recording like a YouTube video: drag anywhere, play
 *  from anywhere, roll back as far as the buffer goes. Cameras follow the
 *  first visible camera's clock.
 *
 *  Layout: fills the viewport. Cameras stack in portrait and sit side by
 *  side in landscape; a phone can focus one camera (the other stops
 *  downloading). Every control lives in the bottom bar within thumb reach. */
export function ReplayConsole({ court }: { court: CourtConfig }) {
  const cams = court.cameras;
  const fpsOf = useCallback((path: string) => cams.find((c) => c.path === path)?.fps ?? 25, [cams]);

  const [engine, setEngine] = useState<Engine | null | undefined>(undefined);
  const [info, setInfo] = useState<Record<string, CamInfo>>({});
  const [infoError, setInfoError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const [ui, setUi] = useState<Ui>(EMPTY_UI);
  const [rate, setRateState] = useState(1);
  const [focus, setFocusState] = useState<string>("all");
  const [scrubVisible, setScrubVisible] = useState(true);
  const [save, setSave] = useState<{ status: "idle" | "saving" | "done" | "error"; msg?: string; id?: string }>({
    status: "idle",
  });
  /** Align panel: which camera is being lined up, its unsaved offset, status. */
  const [align, setAlign] = useState<{ open: boolean; camera: string; msg?: string; busy?: boolean }>({
    open: false,
    camera: "",
  });
  /** Unsaved offsets from the Align panel; the 5 s state poll leaves these alone. */
  const drafts = useRef<Record<string, number>>({});
  const [draftTick, setDraftTick] = useState(0);

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const players = useRef<Record<string, CameraPlayer>>({});
  const failures = useRef<Record<string, string>>({});
  const restarts = useRef<Record<string, number>>({});
  const master = useRef<string | null>(null);
  /** What the user asked for; the tick makes the videos follow it. */
  const wantPlay = useRef(true);
  const rateRef = useRef(1);
  const focusRef = useRef("all");
  const infoRef = useRef<Record<string, CamInfo>>({});
  const waitingSince = useRef<Record<string, number>>({});
  const gaps = useRef<Record<string, boolean>>({});
  /** Followers told to wait while the leading camera downloads a jump. */
  const held = useRef<Record<string, boolean>>({});
  const lastCatchUp = useRef<Record<string, number>>({});
  /** Cameras that have shown a first frame since their player started. */
  const shownFrame = useRef<Record<string, CameraPlayer>>({});
  const scrub = useRef<{ wasPlaying: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const lastWall = useRef<number | null>(null);

  const visiblePaths = useCallback(
    () => cams.filter((c) => shownIn(focusRef.current, c) && isHere(c, infoRef.current)).map((c) => c.path),
    [cams],
  );
  const masterPlayer = useCallback((): CameraPlayer | null => {
    const m = master.current ? players.current[master.current] : undefined;
    if (m && visiblePaths().includes(m.camera)) return m;
    for (const p of visiblePaths()) if (players.current[p]) return players.current[p];
    return null;
  }, [visiblePaths]);

  // ---- engine and recorder state ----
  useEffect(() => {
    let live = true;
    void pickEngine().then((e) => live && setEngine(e));
    return () => {
      live = false;
    };
  }, []);

  const refreshInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/replay/state?court=${encodeURIComponent(court.slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { cameras: Record<string, CamInfo> };
      // a camera that stopped streaming has a closed playlist; when it records
      // again its player starts over at the moment on screen
      for (const [path, ci] of Object.entries(data.cameras)) {
        const p = players.current[path];
        const edge = p?.liveEdge() ?? null;
        if (p && p.ended() && !ci.ended && ci.until !== null && edge !== null && ci.until > edge + 3000) {
          p.destroy();
          delete players.current[path];
        }
      }
      // saved clock corrections (another viewer's Align, or ours): unsaved
      // drafts in this page's Align panel win until saved or reset
      for (const [path, ci] of Object.entries(data.cameras)) {
        const p = players.current[path];
        if (p && drafts.current[path] === undefined) p.setOffset(ci.offsetMs ?? 0);
      }
      infoRef.current = data.cameras;
      setInfo(data.cameras);
      setInfoError(null);
    } catch (e) {
      setInfoError(`Recorder unreachable: ${(e as Error).message}`);
    }
  }, [court.slug]);

  useEffect(() => {
    const first = setTimeout(() => void refreshInfo(), 0);
    const every = setInterval(() => void refreshInfo(), STATE_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [refreshInfo]);

  // ---- one player per camera that has recordings ----
  useEffect(() => {
    if (!engine) return;
    for (const cam of cams) {
      const inf = info[cam.path];
      const have = players.current[cam.path];
      const video = videoRefs.current[cam.path];
      if (!inf || inf.segments === 0 || !video) {
        if (have && (!inf || inf.segments === 0)) {
          have.destroy();
          delete players.current[cam.path];
        }
        continue;
      }
      if (have && have.epoch === inf.epoch) continue;
      // new camera, or the server restarted (new epoch): start at the moment
      // the other camera shows, or near the newest moment on first open
      have?.destroy();
      delete failures.current[cam.path];
      const startWall = lastWall.current;
      const p = new CameraPlayer(cam.path, inf.epoch, video, engine, {
        onUpdate: () => {},
        onFatal: (why) => {
          if (players.current[cam.path] !== p) return;
          p.destroy();
          delete players.current[cam.path];
          failures.current[cam.path] = why;
          const n = (restarts.current[cam.path] ?? 0) + 1;
          restarts.current[cam.path] = n;
          setTimeout(() => {
            void refreshInfo().then(() => setGen((g) => g + 1));
          }, Math.min(30_000, 1000 * 2 ** Math.min(n, 5)));
        },
      });
      players.current[cam.path] = p;
      p.setOffset(drafts.current[cam.path] ?? inf.offsetMs ?? 0);
      p.video.muted = true;
      p.video.playbackRate = rateRef.current;
      void p.start(startWall, OPEN_LEAD_SEC, wantPlay.current);
      if (!shownIn(focusRef.current, cam)) p.setLoading(false);
    }
  }, [engine, info, cams, gen, refreshInfo]);

  useEffect(() => {
    const ps = players.current;
    // browser tests (and ?debug on any build) can read the players' timelines,
    // and which camera leads / which followers are held back (__replayState)
    if (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as { __replay: unknown }).__replay = ps;
      (window as unknown as { __replayState: unknown }).__replayState = { held, master, focus: focusRef, gaps };
    }
    return () => {
      for (const k of Object.keys(ps)) {
        ps[k].destroy();
        delete ps[k];
      }
    };
  }, []);

  // ---- the clock: keep videos on the user's intent and on one another ----
  useEffect(() => {
    const tick = () => {
      const vis = visiblePaths();
      const m = masterPlayer();
      if (m) master.current = m.camera;
      const now = performance.now();

      if (m && !document.hidden) {
        const mv = m.video;
        // the end of a camera that stopped streaming: stay there. (play() on
        // an ended video restarts it from the oldest recorded moment.)
        if (mv.ended) wantPlay.current = false;
        if (wantPlay.current && !scrub.current) {
          if (mv.paused && mv.readyState >= 1) {
            void mv.play().catch((e: Error) => {
              // autoplay refused (iOS low-power mode): wait for a tap on Play
              if (e.name === "NotAllowedError") wantPlay.current = false;
            });
          }
        } else if (!mv.paused) mv.pause();
        if (mv.playbackRate !== rateRef.current) mv.playbackRate = rateRef.current;

        // followers: hard seek when far off or paused, gentle speed change
        // otherwise (a seek per drift used to stall the second camera)
        const mw = m.wallNow();
        const running = !mv.paused && !mv.seeking && mv.readyState >= 3;
        for (const path of vis) {
          const p = players.current[path];
          if (!p || p === m) continue;
          const v = p.video;
          if (mw === null) continue;
          // at the newest moment the follower's last segment can end up to a
          // segment earlier than the leader's: wait at its edge, not "no recording"
          const edge = p.liveEdge();
          const st = p.timeAt(mw) ?? (edge !== null && mw > edge && mw - edge < 4000 ? p.timeAt(edge - 50) : null);
          gaps.current[path] = st === null && edge !== null;
          if (st === null) {
            if (!v.paused) v.pause();
            continue;
          }
          if (held.current[path]) {
            // after a jump the leading camera downloads first: two cameras
            // splitting the line would both show their picture late
            if (mv.seeking || mv.readyState < 2) continue;
            // position first, then resume: resuming first makes hls.js fetch
            // the segment at the old position before it sees the seek
            held.current[path] = false;
            p.seek(st, false);
            p.setLoading(true, st);
            continue;
          }
          if (v.seeking) continue;
          const drift = v.currentTime - st;
          if (!running) {
            if (!v.paused) v.pause();
            v.playbackRate = rateRef.current;
            if (Math.abs(drift) > 0.4 / fpsOf(path)) p.seek(st, false);
          } else {
            if (Math.abs(drift) > 0.5) {
              const last = lastCatchUp.current[path] ?? 0;
              if (now - last > CATCH_UP_EVERY_MS || Math.abs(drift) > 5) {
                lastCatchUp.current[path] = now;
                const lead = p.isBuffered(st) ? 0.05 : CATCH_UP_LEAD_SEC;
                p.seek(st + lead * rateRef.current, false);
              }
            } else {
              const k = Math.abs(drift) < 0.03 ? 1 : Math.min(1.25, Math.max(0.8, 1 - drift * 0.8));
              const r = rateRef.current * k;
              if (Math.abs(v.playbackRate - r) > 0.005) v.playbackRate = r;
            }
            if (v.paused && !v.ended) void v.play().catch(() => {});
          }
        }
      }

      // what the screen shows: paused, the time of the frame actually on
      // screen (a pause can stop between two frames)
      let wall = m?.wallNow() ?? null;
      if (m && m.video.paused && !m.video.seeking && m.frameTime !== null && Math.abs(m.frameTime - m.video.currentTime) < 1 / fpsOf(m.camera)) {
        wall = m.wallAt(m.frameTime) ?? wall;
      }
      if (wall !== null) lastWall.current = wall;
      const inf = infoRef.current;
      const camRanges = cams.map((c) => {
        const p = players.current[c.path];
        const r = p?.ranges();
        return r && r.length ? r : (inf[c.path]?.ranges ?? []);
      });
      const ranges = mergeRanges(camRanges);
      const edges = cams
        .map((c) => players.current[c.path]?.liveEdge() ?? inf[c.path]?.until ?? null)
        .filter((x): x is number => x !== null);
      const tiles: Record<string, Tile> = {};
      for (const c of cams) {
        const p = players.current[c.path];
        const ci = inf[c.path];
        let t: Tile;
        if (!ci) t = { kind: "loading" };
        else if (ci.segments === 0) t = { kind: "none", msg: "nothing recorded yet" };
        else if (failures.current[c.path] && !p) t = { kind: "error", msg: "reconnecting…" };
        else if (!p) t = { kind: "loading" };
        else if (shownFrame.current[c.path] !== p && p.video.readyState < 2) t = { kind: "loading" };
        else if (gaps.current[c.path] && vis.includes(c.path)) t = { kind: "gap", msg: "no recording at this moment" };
        else {
          const v = p.video;
          if (v.readyState >= 2) shownFrame.current[c.path] = p;
          // after the first frame a wait is a spinner over the last picture
          const waitingNow = v.seeking || v.readyState < 2 || (!v.paused && v.readyState < 3);
          if (waitingNow) waitingSince.current[c.path] ??= now;
          else delete waitingSince.current[c.path];
          const since = waitingSince.current[c.path];
          t = { kind: "ok", waiting: since !== undefined && now - since > SPINNER_AFTER_MS };
        }
        tiles[c.path] = t;
      }
      setUi({
        wall,
        playing: !!m && !m.video.paused,
        from: ranges.length ? ranges[0][0] : null,
        until: edges.length ? Math.max(...edges) : null,
        ranges,
        buffered: m ? m.buffered() : [],
        tiles,
      });
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [cams, fpsOf, masterPlayer, visiblePaths]);

  // ---- moving around ----
  const limits = () => {
    const ps = visiblePaths()
      .map((p) => players.current[p])
      .filter((p): p is CameraPlayer => !!p);
    const edges = ps.map((p) => p.liveEdge()).filter((x): x is number => x !== null);
    const starts = ps.map((p) => p.ranges()[0]?.[0]).filter((x): x is number => x !== undefined);
    return { ps, from: starts.length ? Math.min(...starts) : null, until: edges.length ? Math.max(...edges) : null };
  };

  /** Show wall-clock moment `ms` on every visible camera. `play` sets the
   *  play state; leaving it out keeps whatever the user had. */
  const seekWall = (ms: number, play?: boolean) => {
    const { ps, from, until } = limits();
    if (!ps.length || from === null || until === null) return;
    ms = Math.min(Math.max(ms, from), until - 300);
    // the clock follows the first camera that recorded that moment
    let m = ps.find((p) => p.timeAt(ms) !== null);
    if (!m) {
      // nobody recorded it: go to the next moment someone did
      const next = ps
        .map((p) => {
          const t = p.timeAt(ms, true);
          return t === null ? null : p.wallAt(t);
        })
        .filter((x): x is number => x !== null && x >= ms)
        .sort((a, b) => a - b)[0];
      if (next === undefined) return;
      ms = next;
      m = ps.find((p) => p.timeAt(ms) !== null) ?? ps[0];
    }
    master.current = m.camera;
    for (const p of ps) {
      const t = p.timeAt(ms, true);
      if (t === null) continue;
      if (p === m || p.isBuffered(t)) {
        if (held.current[p.camera]) {
          held.current[p.camera] = false;
          p.seek(t, false);
          p.setLoading(true, t);
        } else p.seek(t);
      } else if (held.current[p.camera]) {
        // already waiting for the leader: it will be aligned from the tick
      } else {
        const to = p.seekingTo();
        if (to !== null && Math.abs(to - t) < 1.5) {
          // already downloading that stretch (frame steps, small nudges):
          // retarget without dropping the download
          p.seek(t, false);
        } else {
          // a real jump: this follower stops downloading until the leading
          // camera shows the moment (the tick then aligns it)
          held.current[p.camera] = true;
          p.setLoading(false);
          p.video.pause();
        }
      }
    }
    if (play !== undefined) {
      wantPlay.current = play;
      for (const p of ps) p.setPlaying(play);
      if (!play) for (const p of ps) p.video.pause();
    }
    lastWall.current = ms;
    setUi((u) => ({ ...u, wall: ms }));
  };

  const currentWall = () => masterPlayer()?.wallNow() ?? lastWall.current;

  const play = () => {
    const m = masterPlayer();
    const until = limits().until;
    wantPlay.current = true;
    for (const p of Object.values(players.current)) p.setPlaying(true);
    // pressing play at the newest moment: start a few seconds back
    const w = currentWall();
    if (m && until !== null && w !== null && until - w < 1500) seekWall(until - LIVE_LAG_SEC * 1000);
  };
  const pause = () => {
    wantPlay.current = false;
    for (const p of Object.values(players.current)) {
      p.setPlaying(false);
      p.video.pause();
    }
  };
  const togglePlay = () => (wantPlay.current && !masterPlayer()?.video.paused ? pause() : play());

  const nudge = (sec: number) => {
    const w = currentWall();
    if (w !== null) seekWall(w + sec * 1000);
  };

  /** One frame forward or back (paused), from the frame actually on screen.
   *  The fastest camera on screen that recorded this moment sets the step (a
   *  60 fps detector camera steps 1/60 s; the 25 fps cameras hold their frame
   *  until their next one is due). */
  const step = (n: number) => {
    const w0 = currentWall();
    const cands = visiblePaths()
      .map((p) => players.current[p])
      .filter((p): p is CameraPlayer => !!p && (w0 === null || p.timeAt(w0) !== null))
      .sort((a, b) => fpsOf(b.camera) - fpsOf(a.camera));
    const m = cands[0] ?? masterPlayer();
    if (!m) return;
    master.current = m.camera;
    const fps = fpsOf(m.camera);
    pause();
    const v = m.video;
    const t =
      !v.seeking && m.frameTime !== null && Math.abs(m.frameTime - v.currentTime) < 1 / fps
        ? m.frameTime + (n + 0.5) / fps
        : v.currentTime + n / fps;
    const w = m.wallAt(t);
    if (w !== null) seekWall(w, false);
  };

  const replayLast = (sec: number) => {
    const until = limits().until;
    if (until !== null) seekWall(until - sec * 1000, true);
  };
  const goLive = () => {
    const until = limits().until;
    if (until !== null) seekWall(until - LIVE_LAG_SEC * 1000, true);
  };

  const changeRate = (r: number) => {
    rateRef.current = r;
    setRateState(r);
    for (const p of Object.values(players.current)) p.video.playbackRate = r;
  };

  const setFocus = (f: string) => {
    focusRef.current = f;
    setFocusState(f);
    const w = currentWall();
    for (const cam of cams) {
      const p = players.current[cam.path];
      if (!p) continue;
      const shown = shownIn(f, cam);
      if (!shown) {
        // a hidden camera stops downloading and decoding
        held.current[cam.path] = false;
        p.setLoading(false);
        p.video.pause();
      } else if (!p.isLoading()) {
        // back in view: aligned to the moment on screen before it downloads
        // again (resuming first would fetch where it stopped)
        held.current[cam.path] = true;
      }
    }
    if (cams.some((c) => c.path === f)) master.current = f;
    if (w !== null) seekWall(w);
  };

  // ---- Align: line one camera up with the others ----
  const alignPlayer = () => (align.camera ? players.current[align.camera] : undefined);
  const savedOffset = (path: string) => infoRef.current[path]?.offsetMs ?? 0;
  const currentOffset = (path: string) => drafts.current[path] ?? savedOffset(path);
  /** Move the camera under alignment by `ms` against the others: the others
   *  stay on the moment shown, this camera's picture moves. */
  const shiftAlign = (ms: number) => {
    const path = align.camera;
    const p = alignPlayer();
    const w = currentWall();
    if (!path || !p || w === null) return;
    // the reference clock must be another camera, or the shift moves everything
    const ref = visiblePaths().find((c) => c !== path && players.current[c]);
    if (ref) master.current = ref;
    const next = currentOffset(path) + ms;
    drafts.current[path] = next;
    p.setOffset(next);
    setDraftTick((x) => x + 1);
    pause();
    seekWall(w, false);
  };
  const saveAlign = async () => {
    const path = align.camera;
    if (!path) return;
    setAlign((a) => ({ ...a, busy: true, msg: undefined }));
    try {
      const res = await fetch("/api/replay/offset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ court: court.slug, camera: path, offsetMs: currentOffset(path) }),
      });
      const data = (await res.json()) as { offsetMs?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      delete drafts.current[path];
      await refreshInfo();
      setAlign((a) => ({ ...a, busy: false, msg: `Saved: ${((data.offsetMs ?? 0) / 1000).toFixed(3)} s` }));
    } catch (e) {
      setAlign((a) => ({ ...a, busy: false, msg: `Not saved: ${(e as Error).message}` }));
    }
  };
  const resetAlign = () => {
    const path = align.camera;
    const p = alignPlayer();
    if (!path || !p) return;
    delete drafts.current[path];
    p.setOffset(savedOffset(path));
    setDraftTick((x) => x + 1);
    const w = currentWall();
    if (w !== null) seekWall(w, false);
  };
  const openAlign = () => {
    pause();
    const first =
      here.find((c) => (c.group ?? "var") === "detector" && players.current[c.path]) ?? here[1] ?? here[0];
    setAlign({ open: true, camera: first?.path ?? "" });
  };

  // ---- the bar ----
  const onScrubStart = () => {
    scrub.current = { wasPlaying: wantPlay.current, timer: null };
    for (const p of Object.values(players.current)) p.video.pause();
  };
  const onScrub = (ms: number) => {
    const s = scrub.current;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    const m = masterPlayer();
    const t = m?.timeAt(ms);
    if (m && t !== null && t !== undefined && m.isBuffered(t)) {
      seekWall(ms); // already downloaded: the picture follows the finger
    } else {
      // not downloaded yet: fetch where the finger rests, not every pixel
      s.timer = setTimeout(() => seekWall(ms), 200);
    }
  };
  const onCommit = (ms: number) => {
    const s = scrub.current;
    if (s?.timer) clearTimeout(s.timer);
    scrub.current = null;
    seekWall(ms, s?.wasPlaying ?? wantPlay.current);
  };

  // keyboard: space / K play-pause, J / L ten seconds, arrows one frame
  // (Shift: one second), Home oldest, End newest
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (e.code === "Space" || k === "k") {
        e.preventDefault();
        togglePlay();
      } else if (k === "j") nudge(-10);
      else if (k === "l") nudge(10);
      else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) nudge(-1);
        else step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) nudge(1);
        else step(1);
      } else if (e.key === "Home") {
        const f = limits().from;
        if (f !== null) seekWall(f);
      } else if (e.key === "End") goLive();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // a background tab stops downloading; coming back resumes where it was
  useEffect(() => {
    const h = () => {
      for (const cam of cams) {
        const p = players.current[cam.path];
        if (!p) continue;
        const shown = shownIn(focusRef.current, cam);
        p.setLoading(!document.hidden && shown);
        if (document.hidden) p.video.pause();
      }
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [cams]);

  const saveMoment = async () => {
    const w = currentWall();
    if (w === null) return;
    const label = window.prompt("Label for this moment (optional)", "");
    if (label === null) return;
    const until = limits().until ?? w + 8000;
    const startMs = w - 8000;
    const durationSec = Math.max(2, Math.min(16, (until - startMs) / 1000));
    setSave({ status: "saving" });
    try {
      const res = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courtSlug: court.slug, start: new Date(startMs).toISOString(), durationSec, label }),
      });
      const data = (await res.json()) as { clip?: { id: string }; error?: string };
      if (!res.ok || !data.clip) throw new Error(data.error ?? res.statusText);
      setSave({ status: "done", id: data.clip.id });
    } catch (e) {
      setSave({ status: "error", msg: (e as Error).message });
    }
  };

  const wall = ui.wall;
  const centis = wall !== null ? String(Math.floor((wall % 1000) / 10)).padStart(2, "0") : "00";
  const atLive = ui.playing && wall !== null && ui.until !== null && ui.until - wall < (LIVE_LAG_SEC + 4) * 1000;
  const ready = wall !== null;
  const anyRecording = Object.values(info).some((c) => c.segments > 0);

  const here = cams.filter((c) => isHere(c, info));
  const groups = [...new Set(here.map((c) => c.group ?? "var"))];
  // a focused camera that is no longer in the buffer: show everything instead
  const focusNow = here.some((c) => shownIn(focus, c)) ? focus : "all";
  const shownCams = here.filter((c) => shownIn(focusNow, c));
  const gridClass = gridFor(shownCams.length);
  // (draftTick changes with every Align nudge, so these numbers re-render)
  const alignFps = fpsOf(align.camera);
  const alignOff = align.camera && draftTick >= 0 ? currentOffset(align.camera) : 0;
  const alignUnsaved = align.camera ? drafts.current[align.camera] !== undefined : false;

  const seg = (active: boolean) =>
    ({
      background: active ? "var(--accent)" : "transparent",
      color: active ? "#06202b" : undefined,
      border: "1px solid var(--line)",
    }) as const;

  return (
    <div className="console flex flex-col overflow-y-auto select-none" style={{ height: "calc(100dvh - var(--app-header))" }}>
      {/* top strip: name, clock and status on one row; on narrow screens the
          camera switch wraps to its own full-width row with equal buttons */}
      <div
        className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-2 sm:px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <Link href="/courts" className="text-sm px-1" style={{ color: "var(--muted)" }} aria-label="back to courts">
          ‹
        </Link>
        <span className="font-semibold truncate min-w-0">{court.name}</span>
        <span className="font-mono text-sm tabular-nums flex-1 min-w-0 text-right sm:text-left sm:flex-none">
          {wall !== null ? `${fmtClock(wall)}.${centis}` : "--:--:--"}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: ui.until ? "#0f2f1f" : "#3b1114", color: ui.until ? "#86efac" : "#fca5a5" }}
        >
          {ui.until ? `until ${fmtClock(ui.until)}` : anyRecording ? "loading" : "no recording"}
        </span>
        {here.length > 1 && (
          <div className="flex gap-1 basis-full sm:basis-auto sm:ml-auto items-center">
            <button
              className="!text-xs !min-h-8 px-2 flex-1 sm:flex-none whitespace-nowrap"
              style={seg(focusNow === "all")}
              onClick={() => setFocus("all")}
            >
              {here.length === 2 ? "Both" : "All"}
            </button>
            {groups.length > 1 &&
              groups.map((g) => (
                <button
                  key={g}
                  className="!text-xs !min-h-8 px-2 flex-1 sm:flex-none whitespace-nowrap"
                  style={seg(focus === `group:${g}`)}
                  onClick={() => setFocus(`group:${g}`)}
                >
                  {g === "var" ? "VAR" : "Detector"}
                </button>
              ))}
            {here.length === 2 ? (
              here.map((cam) => (
                <button
                  key={cam.path}
                  className="!text-xs !min-h-8 px-2 flex-1 sm:flex-none min-w-0 truncate"
                  style={seg(focus === cam.path)}
                  onClick={() => setFocus(cam.path)}
                >
                  {cam.label}
                </button>
              ))
            ) : (
              <select
                aria-label="show one camera"
                className="!text-xs !min-h-8 px-1 flex-1 sm:flex-none min-w-0 rounded"
                style={seg(here.some((c) => c.path === focus))}
                value={here.some((c) => c.path === focus) ? focus : ""}
                onChange={(e) => e.target.value && setFocus(e.target.value)}
              >
                <option value="">One camera…</option>
                {here.map((cam) => (
                  <option key={cam.path} value={cam.path}>
                    {cam.label}
                  </option>
                ))}
              </select>
            )}
            <button
              className="!text-xs !min-h-8 px-2 whitespace-nowrap"
              style={seg(align.open)}
              onClick={() => (align.open ? setAlign((a) => ({ ...a, open: false })) : openAlign())}
              title="Line a camera up with the others"
            >
              Align
            </button>
          </div>
        )}
      </div>

      {(infoError || engine === null) && (
        <div className="shrink-0 text-sm px-3 py-1.5" style={{ background: "#3b1114", color: "#fca5a5" }}>
          {engine === null ? "This browser cannot play the replay stream." : infoError}
        </div>
      )}

      {align.open && (
        <div
          className="shrink-0 flex flex-wrap items-center gap-1.5 px-2 sm:px-3 py-1.5 text-sm"
          style={{ borderBottom: "1px solid var(--line)", background: "var(--panel)" }}
        >
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Pause on a clear moment (the ball hitting the floor or the glass), then move this camera until it shows
            the same moment as the others:
          </span>
          <select
            aria-label="camera to align"
            className="!text-xs !min-h-8 px-1 rounded"
            value={align.camera}
            onChange={(e) => setAlign((a) => ({ ...a, camera: e.target.value, msg: undefined }))}
          >
            {here.map((cam) => (
              <option key={cam.path} value={cam.path}>
                {cam.label}
              </option>
            ))}
          </select>
          {[-1000, -100].map((d) => (
            <button key={d} className="!text-xs !min-h-8 px-2" onClick={() => shiftAlign(d)}>
              {d / 1000} s
            </button>
          ))}
          <button className="!text-xs !min-h-8 px-2" onClick={() => shiftAlign(-1000 / alignFps)} title="one frame earlier">
            − frame
          </button>
          <span className="font-mono text-xs tabular-nums px-1">
            {(alignOff / 1000).toFixed(3)} s{alignUnsaved ? " (not saved)" : ""}
          </span>
          <button className="!text-xs !min-h-8 px-2" onClick={() => shiftAlign(1000 / alignFps)} title="one frame later">
            + frame
          </button>
          {[100, 1000].map((d) => (
            <button key={d} className="!text-xs !min-h-8 px-2" onClick={() => shiftAlign(d)}>
              +{d / 1000} s
            </button>
          ))}
          <button
            className="!text-xs !min-h-8 px-2 font-semibold"
            style={{ background: "var(--accent-2)", color: "#03200f", border: "none" }}
            disabled={!alignUnsaved || align.busy}
            onClick={() => void saveAlign()}
          >
            {align.busy ? "Saving…" : "Save for everyone"}
          </button>
          <button className="!text-xs !min-h-8 px-2" disabled={!alignUnsaved} onClick={resetAlign}>
            Undo
          </button>
          {align.msg && <span className="text-xs">{align.msg}</span>}
        </div>
      )}

      {/* cameras: grow to fill, but never collapse below a usable height;
          if the controls need more room than the screen has, the page scrolls */}
      <div className={`flex-1 grid gap-1 p-1 ${gridClass}`} style={{ minHeight: "clamp(200px, 42dvh, 520px)" }}>
        {cams.map((cam) => {
          const t = ui.tiles[cam.path] ?? { kind: "loading" };
          return (
            <div
              key={cam.path}
              className={`relative min-h-0 rounded-lg overflow-hidden ${shownIn(focusNow, cam) && isHere(cam, info) ? "" : "hidden"}`}
              style={{ background: "#000", border: "1px solid var(--line)" }}
            >
              <ZoomPan className="w-full h-full">
                {/* the player attaches the stream itself (hls.js or the
                    browser's HLS); React never sets src */}
                <video
                  ref={(el) => {
                    videoRefs.current[cam.path] = el;
                  }}
                  muted
                  playsInline
                  preload="auto"
                  disableRemotePlayback
                  className="w-full h-full object-contain"
                />
              </ZoomPan>
              <div className="absolute left-2 top-2 text-xs px-2 py-1 rounded bg-black/60 pointer-events-none">
                {cam.label}
                {cam.fps > 30 ? ` · ${cam.fps} fps` : ""}
                {align.open && align.camera === cam.path ? " · aligning" : ""}
              </div>
              {t.kind !== "ok" ? (
                <div
                  className="absolute inset-0 grid place-items-center text-sm pointer-events-none px-6 text-center"
                  style={{ color: "var(--muted)", background: t.kind === "gap" ? "rgba(0,0,0,0.55)" : undefined }}
                >
                  {t.kind === "loading" ? "Loading…" : t.msg}
                </div>
              ) : (
                t.waiting && (
                  <div className="absolute inset-0 grid place-items-center pointer-events-none">
                    <span
                      className="w-9 h-9 rounded-full border-[3px] animate-spin"
                      style={{ borderColor: "rgba(255,255,255,0.25)", borderTopColor: "var(--accent)" }}
                      aria-label="loading"
                    />
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* bottom bar */}
      <div
        className="shrink-0 px-2 sm:px-3 pt-1.5 sm:pt-2 space-y-1.5 sm:space-y-2"
        style={{
          borderTop: "1px solid var(--line)",
          background: "var(--panel)",
          paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))",
        }}
      >
        {scrubVisible && ui.from !== null && ui.until !== null && ui.until > ui.from && (
          <Scrubber
            from={ui.from}
            to={ui.until}
            ranges={ui.ranges}
            buffered={ui.buffered}
            current={wall}
            onScrubStart={onScrubStart}
            onScrub={onScrub}
            onCommit={onCommit}
          />
        )}

        <div className="controls-row flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex gap-1">
            <button onClick={() => nudge(-10)} disabled={!ready} title="back ten seconds (J)" className="tabular-nums">
              −10
            </button>
            <button onClick={() => nudge(-1)} disabled={!ready} title="back one second (Shift+←)">
              −1s
            </button>
            <button onClick={() => step(-1)} disabled={!ready} title="back one frame (←)">
              ◀
            </button>
            <button
              onClick={togglePlay}
              disabled={!ready}
              className="play-btn font-semibold min-w-16 sm:min-w-20"
              style={{ background: "var(--panel-2)" }}
            >
              {ui.playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => step(1)} disabled={!ready} title="forward one frame (→)">
              ▶
            </button>
            <button onClick={() => nudge(1)} disabled={!ready} title="forward one second (Shift+→)">
              +1s
            </button>
            <button onClick={() => nudge(10)} disabled={!ready} title="forward ten seconds (L)" className="tabular-nums">
              +10
            </button>
          </div>

          <div className="flex gap-1">
            {[10, 30, 60].map((s) => (
              <button
                key={s}
                onClick={() => replayLast(s)}
                disabled={!ready}
                className="font-semibold whitespace-nowrap"
                style={{ background: "var(--accent)", color: "#06202b", border: "none" }}
                title={`Replay the last ${s} seconds`}
              >
                ⟲ {s}s
              </button>
            ))}
            <button
              onClick={goLive}
              disabled={!ready}
              className="font-semibold whitespace-nowrap"
              style={atLive ? { background: "#b91c1c", color: "#fff", border: "none" } : undefined}
              title="Back to the newest moment (End)"
            >
              ● Live
            </button>
          </div>

          <div className="flex items-center gap-1">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => changeRate(s)} disabled={!ready} className="text-sm" style={seg(rate === s)}>
                {s}×
              </button>
            ))}
            <button
              onClick={() => setScrubVisible((v) => !v)}
              className="text-sm ml-1"
              title="show or hide the timeline"
              aria-pressed={scrubVisible}
            >
              ⌁
            </button>
            <button
              onClick={saveMoment}
              disabled={!ready || save.status === "saving"}
              className="font-semibold whitespace-nowrap"
              style={{ background: "var(--accent-2)", color: "#03200f", border: "none" }}
            >
              {save.status === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {save.status === "done" && (
          <div className="text-sm">
            Saved.{" "}
            <a className="underline" href={`/clips/${save.id}`}>
              Open the clip
            </a>
          </div>
        )}
        {save.status === "error" && (
          <div className="text-sm" style={{ color: "#fca5a5" }}>
            Could not save: {save.msg}
          </div>
        )}
        <p className="text-xs hidden md:block" style={{ color: "var(--muted)" }}>
          Drag the bar to any moment (All / 30m / 5m / 1m zooms it) · Space or K: play or pause · J / L: ten
          seconds · ← →: one frame · Shift + ← →: one second · Ctrl + scroll, pinch or the + − buttons to zoom the
          picture · drag to pan · double-click to zoom or reset.
        </p>
      </div>
    </div>
  );
}
