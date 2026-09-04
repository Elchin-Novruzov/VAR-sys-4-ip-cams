/** Loads one replay window into a <video> while it downloads.
 *
 *  Until 2026-09-04 a window was fetched with `res.blob()` and played from
 *  memory: nothing showed until the last byte was in, and at 4 Mbps per
 *  camera a 40 s window is 20 MB per camera. On a phone at the club that was
 *  a frozen picture for the whole download, with no sign that anything was
 *  happening.
 *
 *  Now the stream from MediaMTX (init segment, then one moof+mdat per
 *  second) is appended to a Media Source Extensions SourceBuffer as it
 *  arrives, so the first second plays about a second after the request.
 *  The window can be fetched in phases -- the picked moment first, the
 *  run-up to it second -- each with its own timestamp offset inside the
 *  window. Browsers without MSE for this codec (old iPhones, or H.265 on
 *  Chrome) fall back to the blob, fetched in one piece.
 *
 *  iOS 17.1+ exposes MSE as ManagedMediaSource, which only opens when the
 *  element has `disableRemotePlayback` set and the object URL is given via
 *  a <source> child (same dance as hls.js). */

import { Fmp4Splitter, videoCodec } from "./mp4-stream";

export type Phase = {
  /** Wall-clock start of this piece, ms epoch. */
  startMs: number;
  durationSec: number;
  /** Where the piece sits inside the window, seconds from the window start. */
  offsetSec: number;
};

export type Progress = {
  bytes: number;
  /** Seconds of the window the player can already show (MSE only). */
  bufferedSec: number;
  done: boolean;
  mode: "mse" | "blob";
};

export type LoadOptions = {
  url: (phase: Phase) => string;
  /** Whole window, seconds: becomes MediaSource.duration up front so the
   *  scrub bar and the seek target make sense before the data is in. */
  durationSec: number;
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
};

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

type MSCtor = typeof MediaSource;

function mediaSourceCtor(): { ctor: MSCtor; managed: boolean } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { ManagedMediaSource?: MSCtor; MediaSource?: MSCtor };
  if (w.ManagedMediaSource) return { ctor: w.ManagedMediaSource, managed: true };
  if (w.MediaSource) return { ctor: w.MediaSource, managed: false };
  return null;
}

function removeSources(video: HTMLVideoElement) {
  for (const s of Array.from(video.querySelectorAll("source"))) s.remove();
}

/** Drop whatever the element is showing and free its object URL. Call before
 *  a new load and on unmount. */
export function detachVideo(video: HTMLVideoElement) {
  video.pause();
  const prev = video.dataset.objectUrl;
  if (prev) {
    URL.revokeObjectURL(prev);
    delete video.dataset.objectUrl;
  }
  removeSources(video);
  if (video.hasAttribute("src")) {
    video.removeAttribute("src");
    video.load();
  }
}

function attach(video: HTMLVideoElement, url: string, viaSourceElement: boolean) {
  removeSources(video);
  video.removeAttribute("src");
  video.dataset.objectUrl = url;
  if (viaSourceElement) {
    video.disableRemotePlayback = true;
    const s = document.createElement("source");
    s.type = "video/mp4";
    s.src = url;
    video.appendChild(s);
    video.load();
  } else {
    video.src = url;
  }
}

function bufferedSeconds(sb: SourceBuffer | null): number {
  if (!sb) return 0;
  try {
    let t = 0;
    for (let i = 0; i < sb.buffered.length; i++) t += sb.buffered.end(i) - sb.buffered.start(i);
    return t;
  } catch {
    return 0;
  }
}

function abortError(signal: AbortSignal): Error {
  return (signal.reason as Error | undefined) ?? new DOMException("aborted", "AbortError");
}

/** Reads a fetch body chunk by chunk. */
async function* chunks(res: Response): AsyncGenerator<Uint8Array> {
  const reader = res.body!.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}

class UnsupportedCodec extends Error {}

async function loadMse(
  video: HTMLVideoElement,
  ms: MediaSource,
  MS: MSCtor,
  phases: Phase[],
  opts: LoadOptions,
): Promise<Progress> {
  const { signal } = opts;
  let sb: SourceBuffer | null = null;
  const queue: { data: Uint8Array; offset: number }[] = [];
  let bytes = 0;
  let fetching = true;
  let evicted = false;
  const report = (done: boolean): Progress => {
    const p = { bytes, bufferedSec: bufferedSeconds(sb), done, mode: "mse" as const };
    opts.onProgress(p);
    return p;
  };

  let finish!: (p: Progress) => void;
  let fail!: (e: Error) => void;
  const done = new Promise<Progress>((res, rej) => {
    finish = res;
    fail = rej;
  });
  signal.addEventListener("abort", () => fail(abortError(signal)), { once: true });

  const pump = () => {
    if (!sb || sb.updating || ms.readyState !== "open") return;
    const item = queue.shift();
    if (!item) {
      if (!fetching) {
        try {
          ms.endOfStream();
        } catch {
          /* already closed */
        }
        finish(report(true));
      }
      return;
    }
    try {
      if (sb.timestampOffset !== item.offset) sb.timestampOffset = item.offset;
      sb.appendBuffer(item.data as BufferSource);
    } catch (e) {
      const err = e as DOMException;
      if (err.name === "QuotaExceededError" && !evicted && video.currentTime > 8) {
        // The browser's buffer is full (small phones): give up the run-up
        // that has already played and try once more.
        evicted = true;
        queue.unshift(item);
        sb.remove(0, video.currentTime - 5); // updateend -> pump
        return;
      }
      fail(err);
    }
  };

  const openSourceBuffer = async (init: Uint8Array) => {
    const codec = videoCodec(init);
    const mime = `video/mp4; codecs="${codec}"`;
    if (!codec || !MS.isTypeSupported(mime)) throw new UnsupportedCodec(codec ?? "unknown codec");
    if (ms.readyState !== "open") {
      await new Promise<void>((res) => ms.addEventListener("sourceopen", () => res(), { once: true }));
    }
    if (signal.aborted) throw abortError(signal);
    ms.duration = opts.durationSec;
    sb = ms.addSourceBuffer(mime);
    sb.addEventListener("updateend", () => {
      report(false);
      pump();
    });
    sb.addEventListener("error", () => fail(new Error("the browser could not decode this video")));
  };

  const run = async () => {
    let phasesOk = 0;
    for (const phase of phases) {
      let res: Response;
      try {
        res = await fetch(opts.url(phase), { signal, cache: "no-store" });
      } catch (e) {
        if (phasesOk > 0) break; // the moment is in; the run-up is a bonus
        throw e;
      }
      if (!res.ok || !res.body) {
        if (phasesOk > 0) break;
        throw new HttpError(res.status);
      }
      const split = new Fmp4Splitter();
      for await (const chunk of chunks(res)) {
        bytes += chunk.length;
        const { init, segments } = split.push(chunk);
        if (init) {
          if (!sb) await openSourceBuffer(init);
          queue.push({ data: init, offset: phase.offsetSec });
        }
        for (const s of segments) queue.push({ data: s, offset: phase.offsetSec });
        if (init || segments.length) pump();
        else if (bytes % 4 === 0) report(false);
      }
      phasesOk++;
    }
    fetching = false;
    pump();
  };

  run().catch(fail);
  return done;
}

async function loadBlob(video: HTMLVideoElement, phase: Phase, opts: LoadOptions): Promise<Progress> {
  const res = await fetch(opts.url(phase), { signal: opts.signal, cache: "no-store" });
  if (!res.ok || !res.body) throw new HttpError(res.status);
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of chunks(res)) {
    parts.push(chunk);
    bytes += chunk.length;
    opts.onProgress({ bytes, bufferedSec: 0, done: false, mode: "blob" });
  }
  if (opts.signal.aborted) throw abortError(opts.signal);
  const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: "video/mp4" }));
  attach(video, url, false);
  const p: Progress = { bytes, bufferedSec: 0, done: true, mode: "blob" };
  opts.onProgress(p);
  return p;
}

/** Fetches the phases of one window into the element. Resolves when the
 *  last byte is in (long after the first frame is visible); rejects with
 *  HttpError, an AbortError, or a decode error. */
export async function loadWindowInto(video: HTMLVideoElement, phases: Phase[], opts: LoadOptions): Promise<Progress> {
  if (opts.signal.aborted) throw abortError(opts.signal);
  detachVideo(video);
  const whole: Phase = {
    startMs: Math.min(...phases.map((p) => p.startMs)),
    durationSec: opts.durationSec,
    offsetSec: 0,
  };
  const found = mediaSourceCtor();
  if (found && found.ctor.isTypeSupported('video/mp4; codecs="avc1.640028"')) {
    const ms = new found.ctor();
    const url = URL.createObjectURL(ms);
    attach(video, url, found.managed);
    try {
      return await loadMse(video, ms, found.ctor, phases, opts);
    } catch (e) {
      if (!(e instanceof UnsupportedCodec)) throw e;
      // e.g. H.265 on Chrome: the whole window in one piece, the old way
      detachVideo(video);
    }
  }
  return loadBlob(video, whole, opts);
}
