"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CourtConfig, Segment } from "@/lib/types";
import { fmtBytes, fmtClock } from "@/lib/time";
import { detachVideo, loadWindowInto, HttpError, type Phase, type Progress } from "@/lib/window-loader";
import { ZoomPan } from "./zoom-pan";
import { Timeline } from "./timeline";

type Win = { start: number; duration: number }; // ms epoch, seconds

const SPEEDS = [1, 0.5, 0.25, 0.1] as const;
/** Seconds fetched before / after a picked moment. */
const PRE_SEC = 25;
const POST_SEC = 15;
/** A picked moment is fetched in two pieces: from this many seconds before
 *  it to the end of the window first (so the moment shows within a second
 *  or two), then the rest of the run-up. */
const FIRST_SEC = 4;
/** Seconds kept before the live edge when using "Replay last N s". */
const LEAD_SEC = 2;
/** What the page shows on its own when opened: the last N seconds, playing. */
const AUTO_SEC = 30;
/** Short landscape phones: the header and the scrub area hide by default. */
const SHORT_LANDSCAPE = "(max-height: 520px) and (orientation: landscape)";

/** The courtside VAR screen: both ends of the court on one clock, rewind,
 *  scrub, slow motion, frame step, zoom, and "save this moment". Video for
 *  the chosen window streams into each camera's player as it downloads (see
 *  lib/window-loader.ts), so the first frame shows almost at once and every
 *  seek inside the window is local.
 *
 *  Layout: fills the viewport with no page scroll. Cameras stack in portrait
 *  and sit side by side in landscape; a phone can focus one camera. Every
 *  control lives in a bottom bar within thumb reach. */
export function ReplayConsole({ court }: { court: CourtConfig }) {
  const cams = court.cameras;
  const fps = cams[0]?.fps ?? 25;
  const frame = 1 / fps;

  const [segments, setSegments] = useState<Segment[]>([]);
  const [win, setWin] = useState<Win | null>(null);
  /** Per camera: how much of the current window has arrived. Present as soon
   *  as a load starts for that camera, so the tile shows the player. */
  const [loaded, setLoaded] = useState<Record<string, Progress>>({});
  /** Per camera: the player is waiting for data it does not have yet. */
  const [stall, setStall] = useState<Record<string, boolean>>({});
  /** "Loading…" from a load start until the master's first frame is up. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Per-camera reason a window could not be loaded (the other end may still
   *  play): "nothing recorded yet" while a camera is not streaming. */
  const [camError, setCamError] = useState<Record<string, string>>({});
  const [rate, setRate] = useState<number>(1);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [focus, setFocus] = useState<string>("all");
  /** null = automatic (hidden on short landscape screens), else explicit. */
  const [scrub, setScrub] = useState<boolean | null>(null);
  const [save, setSave] = useState<{ status: "idle" | "saving" | "done" | "error"; msg?: string; id?: string }>({
    status: "idle",
  });

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const seekAfterLoad = useRef(0);
  /** The load in flight; a new pick aborts it (each pick used to start
   *  another 20 MB-per-camera download on top of the last one). */
  const loadCtl = useRef<AbortController | null>(null);
  const loadGen = useRef(0);
  /** First open: the last AUTO_SEC seconds load and play by themselves.
   *  autoPlay is true only while that first window is the one loading; it
   *  used to linger on a timer, so a pick made right after the first window
   *  finished started playing on its own. */
  const autoLoaded = useRef(false);
  const autoPlay = useRef(false);

  const all = useCallback(
    () => cams.map((c) => videoRefs.current[c.path]).filter((v): v is HTMLVideoElement => !!v),
    [cams],
  );
  /** The clock everyone follows: the first camera that has video loaded. Was
   *  always cams[0]; with one end not recording yet that left the other end
   *  playing with a dead clock (2026-09-04 club visit). */
  const masterPath = cams.find((c) => loaded[c.path])?.path ?? cams[0]?.path;
  const master = useCallback(() => (masterPath ? videoRefs.current[masterPath] : null) ?? null, [masterPath]);

  // ---- what the recorder holds ----
  const refreshSegments = useCallback(async () => {
    if (!cams[0]) return;
    try {
      const res = await fetch(`/api/video/segments?camera=${encodeURIComponent(cams[0].path)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { segments: Segment[] };
      setSegments(data.segments);
      setError((e) => (e?.startsWith("Recorder") ? null : e));
    } catch (e) {
      setError(`Recorder unreachable: ${(e as Error).message}`);
    }
  }, [cams]);

  useEffect(() => {
    const run = () => void refreshSegments();
    const first = setTimeout(run, 0);
    const every = setInterval(run, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [refreshSegments]);

  // leaving the page: stop the download and free the players
  useEffect(() => {
    const refs = videoRefs.current;
    return () => {
      loadCtl.current?.abort();
      for (const v of Object.values(refs)) if (v) detachVideo(v);
    };
  }, []);

  const avail = useMemo(() => {
    let from = Infinity;
    let until = -Infinity;
    for (const s of segments) {
      const a = new Date(s.start).getTime();
      const b = a + s.duration * 1000;
      if (a < from) from = a;
      if (b > until) until = b;
    }
    return Number.isFinite(from) ? { from, until } : null;
  }, [segments]);

  // ---- load one window into every camera ----
  /** `auto` = the page's own first load, which plays by itself; every
   *  user-driven load starts paused. */
  const loadWindow = useCallback(
    async (startMs: number, durationSec: number, seekToMs: number, auto = false) => {
      if (!avail) return;
      const start = Math.max(startMs, avail.from);
      const end = Math.min(startMs + durationSec * 1000, avail.until);
      if (end - start < 2000) {
        setError("Nothing recorded at that time yet.");
        return;
      }
      const dur = (end - start) / 1000;
      const seekSec = Math.max(0, Math.min((seekToMs - start) / 1000, dur));
      // The moment first, the run-up second: a pick 25 s into the window
      // would otherwise wait for 25 s of video before showing anything.
      const split = seekSec - FIRST_SEC;
      const phases: Phase[] =
        split > 6
          ? [
              { startMs: start + split * 1000, durationSec: dur - split, offsetSec: split },
              { startMs: start, durationSec: split, offsetSec: 0 },
            ]
          : [{ startMs: start, durationSec: dur, offsetSec: 0 }];

      loadCtl.current?.abort();
      const ctl = new AbortController();
      loadCtl.current = ctl;
      const gen = ++loadGen.current;
      const current = () => gen === loadGen.current;

      setBusy("Loading…");
      setError(null);
      setPlaying(false);
      setCamError({});
      setStall({});
      setLoaded({});
      autoPlay.current = auto;
      seekAfterLoad.current = seekSec;
      setWin({ start, duration: dur });
      setPos(seekSec);
      setSave({ status: "idle" });

      // One camera without a recording (not streaming yet, or its buffer
      // does not reach that far back) must not take the other end down: load
      // what exists, tell the missing tile why. Seen at the club before the
      // second camera was on: "South end: HTTP 502" hid the north end too.
      const results = await Promise.allSettled(
        cams.map(async (cam) => {
          const v = videoRefs.current[cam.path];
          if (!v) throw new Error("no player");
          return loadWindowInto(v, phases, {
            url: (p) =>
              `/api/video/get?camera=${encodeURIComponent(cam.path)}` +
              `&start=${encodeURIComponent(new Date(p.startMs).toISOString())}&duration=${p.durationSec.toFixed(3)}`,
            durationSec: dur,
            signal: ctl.signal,
            onProgress: (p) => {
              if (current()) setLoaded((prev) => ({ ...prev, [cam.path]: p }));
            },
          });
        }),
      );
      if (!current()) return; // a newer pick took over
      const failed: Record<string, string> = {};
      let ok = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          ok++;
          return;
        }
        const e = r.reason as Error;
        const why = e instanceof HttpError && (e.status === 404 || e.status === 502) ? "nothing recorded yet" : e.message;
        failed[cams[i].path] = `${cams[i].label}: ${why}`;
      });
      setCamError(failed);
      setLoaded((prev) => {
        const next = { ...prev };
        for (const p of Object.keys(failed)) delete next[p];
        return next;
      });
      if (ok === 0) setError(Object.values(failed).join(" · "));
      setBusy(null);
    },
    [avail, cams],
  );

  const onLoadedMetadata = (path: string) => {
    const v = videoRefs.current[path];
    if (!v) return;
    v.currentTime = seekAfterLoad.current;
    v.playbackRate = rate;
    if (autoPlay.current) {
      // the automatic first load plays by itself; muted video may autoplay
      void v.play().catch(() => {});
      setPlaying(true);
    }
  };

  /** The player ran out of data (still downloading, or a seek past what is
   *  in). A hole of a frame or two between the two pieces of a window is
   *  stepped over rather than waited on. */
  const onWaiting = (path: string) => {
    const v = videoRefs.current[path];
    if (!v) return;
    setStall((s) => (s[path] ? s : { ...s, [path]: true }));
    const t = v.currentTime;
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) {
      const s = b.start(i);
      if (s > t && s - t < 0.5) {
        v.currentTime = s + 0.01;
        break;
      }
    }
  };
  const onReady = (path: string) => {
    setStall((s) => (s[path] ? { ...s, [path]: false } : s));
    if (path === masterPath) setBusy(null);
  };

  // ---- transport ----
  const play = () => {
    for (const v of all()) {
      v.playbackRate = rate;
      void v.play().catch(() => {});
    }
    setPlaying(true);
  };
  const pause = () => {
    for (const v of all()) v.pause();
    setPlaying(false);
  };
  const seekTo = (t: number) => {
    const m = master();
    const d = m?.duration || win?.duration || 0;
    const c = Math.max(0, Math.min(t, Math.max(0, d - 0.001)));
    for (const v of all()) v.currentTime = c;
    setPos(c);
  };
  const step = (n: number) => {
    pause();
    const t = master()?.currentTime ?? 0;
    // land inside the target frame, not on its boundary
    seekTo((Math.round(t * fps) + n) / fps + 0.001);
  };
  const changeRate = (r: number) => {
    setRate(r);
    for (const v of all()) v.playbackRate = r;
  };
  const onTimeUpdate = () => {
    const m = master();
    if (!m) return;
    setPos(m.currentTime);
    for (const v of all()) {
      if (v !== m && Math.abs(v.currentTime - m.currentTime) > 0.08) v.currentTime = m.currentTime;
    }
  };

  // smoother clock while playing
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const m = master();
      if (m) setPos(m.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, master]);

  // keyboard: space, arrows (frame), shift+arrows (second)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (playing) pause();
        else play();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(e.shiftKey ? -fps : -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(e.shiftKey ? fps : 1);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // ---- quick actions ----
  /** Show a moment: seek inside the loaded window when it already covers the
   *  requested range (the data may still be arriving; the player waits for
   *  it), otherwise fetch a new window. */
  const showAt = (startMs: number, durationSec: number, seekToMs: number) => {
    if (win) {
      const winEnd = win.start + win.duration * 1000;
      const covered = win.start <= startMs + 500 && winEnd >= Math.min(startMs + durationSec * 1000, avail?.until ?? Infinity) - 500;
      if (covered) {
        pause();
        setError(null);
        seekTo((seekToMs - win.start) / 1000);
        return;
      }
    }
    void loadWindow(startMs, durationSec, seekToMs);
  };
  const replayLast = (sec: number) => {
    if (!avail) return;
    showAt(avail.until - (sec + LEAD_SEC) * 1000, sec + LEAD_SEC, avail.until - sec * 1000);
  };
  const pick = (ms: number) => showAt(ms - PRE_SEC * 1000, PRE_SEC + POST_SEC, ms);

  // Opening the page shows video at once: the last AUTO_SEC seconds, playing.
  // Runs once, as soon as the recorder reports something to show.
  useEffect(() => {
    if (!avail || win || busy || autoLoaded.current) return;
    autoLoaded.current = true;
    const t = setTimeout(() => {
      void loadWindow(avail.until - (AUTO_SEC + LEAD_SEC) * 1000, AUTO_SEC + LEAD_SEC, avail.until - AUTO_SEC * 1000, true);
    }, 0);
    return () => clearTimeout(t);
  }, [avail, win, busy, loadWindow]);

  const toggleScrub = () => {
    const autoHidden = window.matchMedia(SHORT_LANDSCAPE).matches;
    setScrub((v) => (v === null ? autoHidden : !v));
  };

  const saveMoment = async () => {
    if (!win) return;
    const label = window.prompt("Label for this moment (optional)", "");
    if (label === null) return;
    const startMs = win.start + Math.max(0, pos - 8) * 1000;
    const durationSec = Math.max(2, Math.min(16, win.duration - (startMs - win.start) / 1000));
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

  const curMs = win ? win.start + pos * 1000 : null;
  const centis = String(Math.floor((pos % 1) * 100)).padStart(2, "0");
  const timelineFrom = avail ? Math.max(avail.from, avail.until - court.retentionHours * 3600_000) : 0;

  /** The small "loading" badge on a tile while its window is still coming in. */
  const progressText = (p: Progress | undefined) => {
    if (!p || p.done || !win) return null;
    if (p.mode === "blob") return `loading · ${fmtBytes(p.bytes)}`;
    return `loading · ${Math.floor(p.bufferedSec)} / ${Math.round(win.duration)} s`;
  };

  const gridClass =
    focus === "all"
      ? "portrait:grid-rows-2 portrait:grid-cols-1 landscape:grid-cols-2 landscape:grid-rows-1"
      : "grid-cols-1 grid-rows-1";
  const scrubClass = scrub === null ? "auto-scrub" : scrub ? "" : "hidden";

  const seg = (active: boolean) =>
    ({
      background: active ? "var(--accent)" : "transparent",
      color: active ? "#06202b" : undefined,
      border: "1px solid var(--line)",
    }) as const;

  return (
    <div className="console flex flex-col overflow-y-auto select-none" style={{ height: "calc(100dvh - var(--app-header))" }}>
      {/* top strip: name and status on one row; on narrow screens the camera
          switch wraps to its own full-width row with equal buttons */}
      <div
        className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-2 sm:px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <Link href="/courts" className="text-sm px-1" style={{ color: "var(--muted)" }} aria-label="back to courts">
          ‹
        </Link>
        <span className="font-semibold truncate min-w-0 flex-1">{court.name}</span>
        <span
          className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: avail ? "#0f2f1f" : "#3b1114", color: avail ? "#86efac" : "#fca5a5" }}
        >
          {avail ? `until ${fmtClock(avail.until)}` : "no recording"}
        </span>
        {cams.length > 1 && (
          <div className="flex gap-1 basis-full sm:basis-auto sm:ml-auto">
            <button
              className="!text-xs !min-h-8 px-2 flex-1 sm:flex-none whitespace-nowrap"
              style={seg(focus === "all")}
              onClick={() => setFocus("all")}
            >
              Both
            </button>
            {cams.map((cam) => (
              <button
                key={cam.path}
                className="!text-xs !min-h-8 px-2 flex-1 sm:flex-none min-w-0 truncate"
                style={seg(focus === cam.path)}
                onClick={() => setFocus(cam.path)}
              >
                {cam.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 text-sm px-3 py-1.5" style={{ background: "#3b1114", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* cameras: grow to fill, but never collapse below a usable height;
          if the controls need more room than the screen has, the page scrolls */}
      <div className={`flex-1 grid gap-1 p-1 ${gridClass}`} style={{ minHeight: "clamp(200px, 42dvh, 520px)" }}>
        {cams.map((cam) => {
          const badge = progressText(loaded[cam.path]);
          return (
            <div
              key={cam.path}
              className={`relative min-h-0 rounded-lg overflow-hidden ${focus === "all" || focus === cam.path ? "" : "hidden"}`}
              style={{ background: "#000", border: "1px solid var(--line)" }}
            >
              <ZoomPan className="w-full h-full">
                {/* src is attached by the loader (a MediaSource or a blob),
                    not by React, so a load in progress is never re-rendered
                    away. */}
                <video
                  ref={(el) => {
                    videoRefs.current[cam.path] = el;
                  }}
                  muted
                  playsInline
                  preload="auto"
                  className="w-full h-full object-contain"
                  onLoadedMetadata={() => onLoadedMetadata(cam.path)}
                  onWaiting={() => onWaiting(cam.path)}
                  onCanPlay={() => onReady(cam.path)}
                  onSeeked={() => onReady(cam.path)}
                  onPlaying={() => onReady(cam.path)}
                  onTimeUpdate={cam.path === masterPath ? onTimeUpdate : undefined}
                  onEnded={cam.path === masterPath ? () => setPlaying(false) : undefined}
                />
              </ZoomPan>
              <div className="absolute left-2 top-2 text-xs px-2 py-1 rounded bg-black/60 pointer-events-none">
                {cam.label}
              </div>
              {badge && (
                <div
                  className="absolute right-2 bottom-2 text-xs px-2 py-1 rounded bg-black/60 pointer-events-none tabular-nums"
                  style={{ color: "var(--muted)" }}
                >
                  {badge}
                </div>
              )}
              {!loaded[cam.path] ? (
                <div
                  className="absolute inset-0 grid place-items-center text-sm pointer-events-none px-6 text-center"
                  style={{ color: "var(--muted)" }}
                >
                  {busy ?? camError[cam.path] ?? (avail ? "Loading the latest video…" : "Waiting for the cameras…")}
                </div>
              ) : (
                stall[cam.path] && (
                  <div
                    className="absolute inset-0 grid place-items-center text-sm pointer-events-none"
                    style={{ color: "var(--muted)" }}
                  >
                    <span className="px-3 py-1.5 rounded bg-black/60">waiting for video…</span>
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
        <div className={`space-y-1 sm:space-y-2 ${scrubClass}`}>
          {win && (
            <input
              type="range"
              min={0}
              max={win.duration}
              step={frame}
              value={pos}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="w-full"
              aria-label="position inside the loaded window"
            />
          )}
          {avail && (
            <Timeline from={timelineFrom} to={avail.until} segments={segments} current={curMs} onPick={pick} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex gap-1">
            {[10, 30, 60].map((s) => (
              <button
                key={s}
                onClick={() => replayLast(s)}
                disabled={!avail}
                className="font-semibold whitespace-nowrap"
                style={{ background: "var(--accent)", color: "#06202b", border: "none" }}
                title={`Replay the last ${s} seconds`}
              >
                ⟲ {s}s
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            <button onClick={() => seekTo(pos - 1)} disabled={!win} title="back one second">
              −1s
            </button>
            <button onClick={() => step(-1)} disabled={!win} title="back one frame">
              ◀
            </button>
            <button
              onClick={playing ? pause : play}
              disabled={!win}
              className="font-semibold min-w-20"
              style={{ background: "var(--panel-2)" }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => step(1)} disabled={!win} title="forward one frame">
              ▶
            </button>
            <button onClick={() => seekTo(pos + 1)} disabled={!win} title="forward one second">
              +1s
            </button>
          </div>

          <div className="flex gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => changeRate(s)}
                disabled={!win}
                className="text-sm"
                style={seg(rate === s)}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <span className="font-mono text-sm tabular-nums">{curMs !== null ? `${fmtClock(curMs)}.${centis}` : "--:--:--"}</span>
            <button onClick={toggleScrub} className="text-sm" title="show or hide the timeline">
              ⌁
            </button>
            <button
              onClick={saveMoment}
              disabled={!win || save.status === "saving"}
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
          Space: play or pause · ← → one frame · Shift + ← → one second · Ctrl + scroll, trackpad pinch or the
          + − buttons to zoom · drag to pan · double-click to zoom or reset.
        </p>
      </div>
    </div>
  );
}
