/** The replay buffer as HLS, served straight from MediaMTX's recording files.
 *
 *  Why (2026-10-21): the replay page used to fetch 40 s windows through
 *  MediaMTX's /get and play each from memory. Rolling back past the start of
 *  a window meant a fresh 20 MB-per-camera download (16 s of blank picture
 *  on a phone on 4G, measured), the slider stopped 25 s before the picked
 *  moment, and the 4 h bar was 39 s per pixel. The club asked for "YouTube":
 *  one timeline over the whole recording, drag anywhere, play from anywhere.
 *
 *  How: MediaMTX records every camera as fMP4 files of ~15 s (1 s parts;
 *  every file starts on a keyframe; the `mtxi` box in each file's moov holds
 *  the stream id, the stream time and the wall-clock time of its start).
 *  This module indexes those files -- moof boxes only, the video bytes are
 *  never read for indexing -- cuts each file into ~2 s pieces on keyframe
 *  boundaries, and serves per camera:
 *    - a live HLS playlist covering everything on disk, with delta updates
 *      (CAN-SKIP-UNTIL), so a reload costs a few lines, not 7 000;
 *    - one init section per recording session (ftyp + moov, video track
 *      only, durations zeroed so every file of the session gives the same
 *      bytes);
 *    - media segments remuxed on the fly (one moof+mdat each, ~1 MB per
 *      camera at 4 Mbps), cut from finished parts only, so a URL never
 *      changes its bytes.
 *  Timestamps are the stream's own (mtxi DTS) and wall clock comes from the
 *  mtxi NTP field, so a segment URL always yields the same bytes and nothing
 *  depends on the time zone in the file names. */

import { createHash, randomBytes } from "node:crypto";
import { open, readdir, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";

/** HLS segment length: whole GOPs until at least this many seconds. The
 *  cameras key every second (I-frame interval 25 at 25 fps), so 2 s = two
 *  GOPs: about 1 MB per camera to show any moment of the buffer. */
export const SEGMENT_TARGET_SEC = 2;
/** Delta playlists leave out everything older than this many seconds from
 *  the live edge. Must be at least six target durations (RFC 8216bis). */
const CAN_SKIP_UNTIL_SEC = 30;
const MIN_TARGET_DURATION = 2;
/** A file nobody has written to for this long is complete even without its
 *  closing duration (MediaMTX stopped, publisher gone for good). */
const STALE_MS = 10_000;
/** The directory is re-read at most this often per camera. */
const REFRESH_EVERY_MS = 1000;
/** Upper bound for one segment request (60 s at 25 fps). */
const MAX_SEGMENT_SAMPLES = 1500;
/** Files with the same stream and codec join one session when the next one
 *  starts within this much of where the last one ended. */
const JOIN_TOLERANCE_SEC = 1;

/** MediaMTX's recordPath `%Y-%m-%d_%H-%M-%S-%f`. */
export const RECORDING_NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{6}$/;

/** Where MediaMTX writes `<camera>/<name>.mp4`. Docker: the recordings
 *  volume mounted read-only into the web container (infra/docker-compose.yml). */
export function recordingsDir(): string {
  const d = process.env.RECORDINGS_DIR ?? "recordings";
  // The ignore comment keeps Turbopack from tracing the recordings folder
  // into the build output.
  return path.isAbsolute(d) ? d : path.join(/* turbopackIgnore: true */ process.cwd(), d);
}

// ---------------------------------------------------------------- MP4 boxes

type Box = { type: string; start: number; end: number; body: number };

/** The box starting at b[p], if its header is inside b[.., end). */
function boxAt(b: Buffer, p: number, end: number): Box | null {
  if (p + 8 > end) return null;
  let size = b.readUInt32BE(p);
  let body = p + 8;
  if (size === 1) {
    if (p + 16 > end) return null;
    size = Number(b.readBigUInt64BE(p + 8));
    body = p + 16;
  } else if (size === 0) {
    size = end - p;
  }
  if (size < body - p) return null;
  return { type: b.toString("latin1", p + 4, p + 8), start: p, end: p + size, body };
}

function kids(b: Buffer, parent: Box, skip = 0): Box[] {
  const out: Box[] = [];
  let p = parent.body + skip;
  while (p < parent.end) {
    const x = boxAt(b, p, parent.end);
    if (!x || x.end > parent.end) break;
    out.push(x);
    p = x.end;
  }
  return out;
}

const firstOf = (bs: Box[], type: string) => bs.find((x) => x.type === type);

function makeBox(type: string, ...parts: Buffer[]): Buffer {
  const size = 8 + parts.reduce((a, p) => a + p.length, 0);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(size, 0);
  h.write(type, 4, "latin1");
  return Buffer.concat([h, ...parts], size);
}

/** Positional reads with a small read-ahead window: one moof, its mdat
 *  header and often the next moof header come in one read. */
class FileReader {
  private buf = Buffer.alloc(0);
  private bufPos = 0;
  constructor(
    private fh: FileHandle,
    readonly size: number,
  ) {}

  async bytes(pos: number, n: number): Promise<Buffer> {
    if (pos >= this.bufPos && pos + n <= this.bufPos + this.buf.length) {
      return this.buf.subarray(pos - this.bufPos, pos - this.bufPos + n);
    }
    const len = Math.min(Math.max(n, 8192), this.size - pos);
    const b = Buffer.alloc(len);
    const { bytesRead } = await this.fh.read(b, 0, len, pos);
    this.buf = b.subarray(0, bytesRead);
    this.bufPos = pos;
    if (bytesRead < n) throw new Error("short read");
    return this.buf.subarray(0, n);
  }
}

// ------------------------------------------------------- one recording file

type TrexDefaults = { dur: number; size: number; flags: number };

type InitInfo = {
  trackId: number;
  timescale: number;
  /** Sample entry type of the video track, e.g. avc1 / hvc1. */
  codec: string;
  /** ftyp + moov for the player: video track only, durations zeroed. */
  init: Buffer;
  /** Content hash of `init`; names the init section in playlists. */
  initKey: string;
  /** mvhd duration: MediaMTX writes it when it closes the file. 0 = open. */
  closedDurationMs: number;
  trex: TrexDefaults;
  mtxi: { streamId: string; segNo: number; dtsNs: bigint; ntpNs: bigint } | null;
};

/** Video samples of one file. dts are relative to the segment's start in
 *  track ticks (that is what MediaMTX writes into tfdt). */
type Samples = {
  n: number;
  off: Float64Array;
  size: Uint32Array;
  dur: Uint32Array;
  dts: Float64Array;
  sync: Uint8Array;
  cto: Int32Array | null;
};

function parseInit(ftyp: Buffer, moovBuf: Buffer): InitInfo | null {
  const moov = boxAt(moovBuf, 0, moovBuf.length);
  if (!moov || moov.type !== "moov") return null;
  const mk = kids(moovBuf, moov);
  const mvhd = firstOf(mk, "mvhd");
  if (!mvhd) return null;
  const mvV = moovBuf[mvhd.body];
  const mvTimescale = moovBuf.readUInt32BE(mvhd.body + (mvV === 1 ? 20 : 12));
  const mvDur = mvV === 1 ? Number(moovBuf.readBigUInt64BE(mvhd.body + 24)) : moovBuf.readUInt32BE(mvhd.body + 16);

  let video: { trak: Box; trackId: number; timescale: number; codec: string } | null = null;
  for (const trak of mk.filter((x) => x.type === "trak")) {
    const tk = kids(moovBuf, trak);
    const tkhd = firstOf(tk, "tkhd");
    const mdia = firstOf(tk, "mdia");
    if (!tkhd || !mdia) continue;
    const md = kids(moovBuf, mdia);
    const hdlr = firstOf(md, "hdlr");
    const mdhd = firstOf(md, "mdhd");
    const minf = firstOf(md, "minf");
    if (!hdlr || !mdhd || !minf) continue;
    if (moovBuf.toString("latin1", hdlr.body + 8, hdlr.body + 12) !== "vide") continue;
    const trackId = moovBuf.readUInt32BE(tkhd.body + (moovBuf[tkhd.body] === 1 ? 20 : 12));
    const timescale = moovBuf.readUInt32BE(mdhd.body + (moovBuf[mdhd.body] === 1 ? 20 : 12));
    const stbl = firstOf(kids(moovBuf, minf), "stbl");
    const stsd = stbl ? firstOf(kids(moovBuf, stbl), "stsd") : undefined;
    const codec = stsd ? moovBuf.toString("latin1", stsd.body + 12, stsd.body + 16) : "?";
    video = { trak, trackId, timescale, codec };
    break;
  }
  if (!video || !video.timescale) return null;

  let trex: TrexDefaults = { dur: 0, size: 0, flags: 0 };
  let trexBox: Buffer | null = null;
  const mvex = firstOf(mk, "mvex");
  if (mvex) {
    for (const t of kids(moovBuf, mvex)) {
      if (t.type === "trex" && moovBuf.readUInt32BE(t.body + 4) === video.trackId) {
        trex = {
          dur: moovBuf.readUInt32BE(t.body + 12),
          size: moovBuf.readUInt32BE(t.body + 16),
          flags: moovBuf.readUInt32BE(t.body + 20),
        };
        trexBox = moovBuf.subarray(t.start, t.end);
      }
    }
  }
  if (!trexBox) {
    const t = Buffer.alloc(24);
    t.writeUInt32BE(video.trackId, 4);
    t.writeUInt32BE(1, 8); // default sample description index
    trexBox = makeBox("trex", t);
  }

  let mtxi: InitInfo["mtxi"] = null;
  const udta = firstOf(mk, "udta");
  const mx = udta ? firstOf(kids(moovBuf, udta), "mtxi") : undefined;
  if (mx && mx.end - mx.body >= 44) {
    const p = mx.body + 4; // version + flags
    mtxi = {
      streamId: moovBuf.toString("hex", p, p + 16),
      segNo: Number(moovBuf.readBigUInt64BE(p + 16)),
      dtsNs: moovBuf.readBigInt64BE(p + 24),
      ntpNs: moovBuf.readBigInt64BE(p + 32),
    };
  }

  // The player's init section: mvhd with its duration zeroed (MediaMTX fills
  // it in when the file closes, and MSE would take it as the stream length),
  // the video trak, and an mvex with only that track's trex. Audio tracks
  // and the mtxi user data stay out.
  const mvhdCopy = Buffer.from(moovBuf.subarray(mvhd.start, mvhd.end));
  const rel = mvhd.body - mvhd.start;
  if (mvV === 1) mvhdCopy.writeBigUInt64BE(BigInt(0), rel + 24);
  else mvhdCopy.writeUInt32BE(0, rel + 16);
  const init = Buffer.concat([
    ftyp,
    makeBox("moov", mvhdCopy, Buffer.from(moovBuf.subarray(video.trak.start, video.trak.end)), makeBox("mvex", trexBox)),
  ]);
  return {
    trackId: video.trackId,
    timescale: video.timescale,
    codec: video.codec,
    init,
    initKey: createHash("sha1").update(init).digest("hex").slice(0, 16),
    closedDurationMs: mvTimescale ? (mvDur * 1000) / mvTimescale : 0,
    trex,
    mtxi,
  };
}

/** Growable sample columns while a file is parsed. */
class SampleAcc {
  off: number[] = [];
  size: number[] = [];
  dur: number[] = [];
  dts: number[] = [];
  sync: number[] = [];
  cto: number[] = [];
  anyCto = false;
  nextDts = 0;

  /** Adds the video samples of one moof. Nothing is added when any of them
   *  points past `fileSize` (the mdat is still being written). */
  moof(b: Buffer, moofPos: number, info: InitInfo, fileSize: number): boolean {
    const moof = boxAt(b, 0, b.length);
    if (!moof) return false;
    const add: number[][] = [];
    let nextDts = this.nextDts;
    for (const traf of kids(b, moof).filter((x) => x.type === "traf")) {
      const tk = kids(b, traf);
      const tfhd = firstOf(tk, "tfhd");
      if (!tfhd) continue;
      const fl = b.readUInt32BE(tfhd.body) & 0xffffff;
      if (b.readUInt32BE(tfhd.body + 4) !== info.trackId) continue;
      let p = tfhd.body + 8;
      let base = moofPos;
      if (fl & 0x01) {
        base = Number(b.readBigUInt64BE(p));
        p += 8;
      }
      if (fl & 0x02) p += 4;
      let defDur = info.trex.dur;
      let defSize = info.trex.size;
      let defFlags = info.trex.flags;
      if (fl & 0x08) {
        defDur = b.readUInt32BE(p);
        p += 4;
      }
      if (fl & 0x10) {
        defSize = b.readUInt32BE(p);
        p += 4;
      }
      if (fl & 0x20) defFlags = b.readUInt32BE(p);
      const tfdt = firstOf(tk, "tfdt");
      let dts = tfdt ? (b[tfdt.body] === 1 ? Number(b.readBigUInt64BE(tfdt.body + 4)) : b.readUInt32BE(tfdt.body + 4)) : nextDts;
      let pos = base;
      for (const trun of tk.filter((x) => x.type === "trun")) {
        const v = b[trun.body];
        const tf = b.readUInt32BE(trun.body) & 0xffffff;
        const n = b.readUInt32BE(trun.body + 4);
        let q = trun.body + 8;
        if (tf & 0x01) {
          pos = base + b.readInt32BE(q);
          q += 4;
        }
        let firstFlags: number | null = null;
        if (tf & 0x04) {
          firstFlags = b.readUInt32BE(q);
          q += 4;
        }
        for (let i = 0; i < n; i++) {
          let d = defDur;
          let s = defSize;
          let f = i === 0 && firstFlags !== null ? firstFlags : defFlags;
          let c = 0;
          if (tf & 0x100) {
            d = b.readUInt32BE(q);
            q += 4;
          }
          if (tf & 0x200) {
            s = b.readUInt32BE(q);
            q += 4;
          }
          if (tf & 0x400) {
            f = b.readUInt32BE(q);
            q += 4;
          }
          if (tf & 0x800) {
            c = v === 1 ? b.readInt32BE(q) : b.readUInt32BE(q);
            q += 4;
          }
          if (pos + s > fileSize) return false;
          add.push([pos, s, d, dts, (f & 0x10000) === 0 ? 1 : 0, c]);
          pos += s;
          dts += d;
        }
      }
      nextDts = dts;
    }
    for (const [o, s, d, t, k, c] of add) {
      this.off.push(o);
      this.size.push(s);
      this.dur.push(d);
      this.dts.push(t);
      this.sync.push(k);
      this.cto.push(c);
      if (c) this.anyCto = true;
    }
    this.nextDts = nextDts;
    return true;
  }

  done(): Samples {
    return {
      n: this.off.length,
      off: Float64Array.from(this.off),
      size: Uint32Array.from(this.size),
      dur: Uint32Array.from(this.dur),
      dts: Float64Array.from(this.dts),
      sync: Uint8Array.from(this.sync),
      cto: this.anyCto ? Int32Array.from(this.cto) : null,
    };
  }
}

type Parsed = { size: number; mtimeMs: number; info: InitInfo; samples: Samples };

/** Reads the boxes of one recording file: its init and every complete
 *  moof. Returns null for a file without a usable video track yet. */
async function parseFile(full: string): Promise<Parsed | null> {
  let fh: FileHandle;
  try {
    fh = await open(full, "r");
  } catch {
    return null;
  }
  try {
    const st = await fh.stat();
    const size = st.size;
    const r = new FileReader(fh, size);
    const acc = new SampleAcc();
    let ftyp: Buffer | null = null;
    let info: InitInfo | null = null;
    let p = 0;
    while (p + 8 <= size) {
      const hb = await r.bytes(p, Math.min(16, size - p));
      let bsize = hb.readUInt32BE(0);
      const type = hb.toString("latin1", 4, 8);
      let hl = 8;
      if (bsize === 1) {
        if (hb.length < 16) break;
        bsize = Number(hb.readBigUInt64BE(8));
        hl = 16;
      } else if (bsize === 0) {
        bsize = size - p;
      }
      if (bsize < hl || p + bsize > size) break; // still being written
      if (type === "ftyp") {
        ftyp = Buffer.from(await r.bytes(p, bsize));
      } else if (type === "moov") {
        if (!ftyp) return null;
        info = parseInit(ftyp, Buffer.from(await r.bytes(p, bsize)));
        if (!info) return null;
      } else if (type === "moof") {
        if (!info || bsize > 8 << 20) return null;
        if (!acc.moof(await r.bytes(p, bsize), p, info, size)) break;
      }
      p += bsize;
    }
    if (!info) return null;
    return { size, mtimeMs: st.mtimeMs, info, samples: acc.done() };
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => {});
  }
}

// ------------------------------------------------------------- the index

/** One recording session: consecutive files of one publisher stream with
 *  the same codec setup and no time gap. A new session in the playlist is an
 *  EXT-X-DISCONTINUITY with its own init section. */
type Run = {
  /** Discontinuity sequence number. */
  seq: number;
  initKey: string;
  timescale: number;
  streamId: string | null;
  /** Where the last file so far ends, in stream ticks and wall-clock ms. */
  endAbs: number;
  endWall: number;
};

type FileEntry = {
  name: string;
  size: number;
  mtimeMs: number;
  final: boolean;
  info: InitInfo;
  s: Samples;
  /** Stream time of the segment start, in track ticks (from mtxi). */
  baseTicks: number;
  /** Wall clock of the segment start, ms since epoch (from mtxi). */
  ntpMs: number;
  /** Samples [0, chunked) are already in segments. */
  chunked: number;
  run: Run;
};

export type Chunk = {
  sn: number;
  file: FileEntry;
  from: number;
  to: number;
  /** Duration in track ticks. */
  dur: number;
  /** Wall clock of the first frame, ms. */
  wall: number;
  run: Run;
};

/** "2026-09-03_09-57-18-454482" read as local time, for files without mtxi. */
function nameToMs(name: string): number {
  const m = /^(\d+)-(\d+)-(\d+)_(\d+)-(\d+)-(\d+)-(\d+)$/.exec(name);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() + Number(m[7]) / 1000;
}

function nsToTicks(ns: bigint, timescale: number): number {
  const billion = BigInt(1_000_000_000);
  return Number((ns * BigInt(timescale) + billion / BigInt(2)) / billion);
}

export class CameraIndex {
  /** Changes whenever sequence numbers restart (process start, or the
   *  index had to be rebuilt). Players carry it in the playlist URL and are
   *  re-created when it no longer matches. */
  epoch = randomBytes(6).toString("base64url");
  files: FileEntry[] = [];
  chunks: Chunk[] = [];
  targetDuration = MIN_TARGET_DURATION;
  private nextSn = 0;
  private nextRunSeq = 0;
  private inits = new Map<string, Buffer>();
  private lastRefresh = 0;
  private refreshing: Promise<void> | null = null;

  constructor(readonly camera: string) {}

  get dir() {
    return path.join(recordingsDir(), this.camera);
  }

  /** Brings the index up to date unless it was refreshed in the last
   *  `maxAgeMs`. Concurrent callers share one refresh. */
  async fresh(maxAgeMs = REFRESH_EVERY_MS): Promise<this> {
    if (this.refreshing) {
      await this.refreshing;
      return this;
    }
    if (Date.now() - this.lastRefresh < maxAgeMs) return this;
    this.refreshing = this.refresh()
      .catch((e) => console.error(`[replay] ${this.camera}: index refresh failed:`, e))
      .finally(() => {
        this.lastRefresh = Date.now();
        this.refreshing = null;
      });
    await this.refreshing;
    return this;
  }

  file(name: string): FileEntry | undefined {
    // newest files are asked for most; search from the end
    for (let i = this.files.length - 1; i >= 0; i--) if (this.files[i].name === name) return this.files[i];
    return undefined;
  }

  init(key: string): Buffer | undefined {
    return this.inits.get(key);
  }

  private reset(why: string) {
    console.warn(`[replay] ${this.camera}: rebuilding the index (${why})`);
    this.epoch = randomBytes(6).toString("base64url");
    this.files = [];
    this.chunks = [];
    this.nextSn = 0;
    this.nextRunSeq = 0;
  }

  private async refresh() {
    let names: string[] = [];
    try {
      names = (await readdir(this.dir))
        .filter((n) => n.endsWith(".mp4"))
        .map((n) => n.slice(0, -4))
        .filter((n) => RECORDING_NAME_RE.test(n))
        .sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const present = new Set(names);

    // MediaMTX deletes the oldest files (recordDeleteAfter); drop them.
    while (this.files.length && !present.has(this.files[0].name)) {
      const gone = this.files.shift()!;
      while (this.chunks.length && this.chunks[0].file === gone) this.chunks.shift();
    }
    if (this.files.some((f) => !present.has(f.name))) this.reset("a file vanished from the middle of the buffer");

    const last = this.files.at(-1)?.name;
    const newer = last ? names.filter((n) => n > last) : names;

    // Files indexed earlier but still open: normally only the newest one.
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i];
      if (f.final) continue;
      const hasNewer = i < this.files.length - 1 || newer.length > 0;
      await this.update(f, hasNewer);
    }

    // New files: parsed eight at a time, added in order.
    for (let i = 0; i < newer.length; i += 8) {
      const batch = newer.slice(i, i + 8);
      const parsed = await Promise.all(batch.map((n) => parseFile(path.join(this.dir, `${n}.mp4`))));
      for (let j = 0; j < batch.length; j++) {
        const isLast = i + j === newer.length - 1;
        const p = parsed[j];
        if (!p) {
          // The newest file may have been created a moment ago with no
          // complete part yet: try again on the next refresh. An older one
          // is broken; leave it out for good.
          if (isLast) return;
          continue;
        }
        this.add(batch[j], p, !isLast);
      }
    }
  }

  private isFinal(p: Parsed, hasNewer: boolean) {
    return p.info.closedDurationMs > 0 || hasNewer || Date.now() - p.mtimeMs > STALE_MS;
  }

  private add(name: string, p: Parsed, hasNewer: boolean) {
    const prev = this.files.at(-1);
    const ts = p.info.timescale;
    const mtxi = p.info.mtxi;
    let ntpMs = mtxi ? Number(mtxi.ntpNs / BigInt(1000)) / 1000 : nameToMs(name);
    let baseTicks = mtxi ? nsToTicks(mtxi.dtsNs, ts) : 0;

    let run: Run | null = null;
    const r = prev?.run;
    if (r && r.initKey === p.info.initKey && r.timescale === ts) {
      const sameStream = !mtxi || !prev.info.mtxi || mtxi.streamId === prev.info.mtxi.streamId;
      if (!mtxi) baseTicks = r.endAbs - (p.samples.n ? p.samples.dts[0] : 0);
      const tol = JOIN_TOLERANCE_SEC;
      if (sameStream && Math.abs(baseTicks - r.endAbs) <= tol * ts && Math.abs(ntpMs - r.endWall) <= tol * 1500) run = r;
    }
    if (!run) {
      if (!mtxi) ntpMs = nameToMs(name);
      run = {
        seq: this.nextRunSeq++,
        initKey: p.info.initKey,
        timescale: ts,
        streamId: mtxi?.streamId ?? null,
        endAbs: baseTicks,
        endWall: ntpMs,
      };
    }
    const f: FileEntry = {
      name,
      size: p.size,
      mtimeMs: p.mtimeMs,
      final: this.isFinal(p, hasNewer),
      info: p.info,
      s: p.samples,
      baseTicks,
      ntpMs,
      chunked: 0,
      run,
    };
    this.inits.set(p.info.initKey, p.info.init);
    this.files.push(f);
    this.settle(f);
  }

  /** Re-reads a file that was still being written. */
  private async update(f: FileEntry, hasNewer: boolean) {
    const full = path.join(this.dir, `${f.name}.mp4`);
    const st = await stat(full).catch(() => null);
    if (st && st.size === f.size && st.mtimeMs === f.mtimeMs) {
      // nothing new in it; it may only have become final (newer file, or quiet)
      const final = f.info.closedDurationMs > 0 || hasNewer || Date.now() - f.mtimeMs > STALE_MS;
      if (final) {
        f.final = true;
        this.settle(f);
      }
      return;
    }
    const p = await parseFile(full);
    if (!p) {
      f.final = hasNewer;
      if (f.final) this.settle(f);
      return;
    }
    if (p.samples.n < f.chunked) {
      // never happens with MediaMTX (files only grow); keep what was listed
      f.final = true;
      return;
    }
    f.size = p.size;
    f.mtimeMs = p.mtimeMs;
    f.s = p.samples;
    f.info = { ...p.info, initKey: f.info.initKey, init: f.info.init };
    f.final = this.isFinal(p, hasNewer);
    this.settle(f);
  }

  /** Updates the session end and cuts the newly complete samples into
   *  segments: whole GOPs until SEGMENT_TARGET_SEC. A GOP counts as complete
   *  once the next keyframe is in the file, or when the file is final. */
  private settle(f: FileEntry) {
    const s = f.s;
    const ts = f.info.timescale;
    if (s.n) {
      const endRel = s.dts[s.n - 1] + s.dur[s.n - 1];
      f.run.endAbs = f.baseTicks + endRel;
      f.run.endWall = f.ntpMs + (endRel / ts) * 1000;
    }
    let start = f.chunked;
    if (start === 0) {
      // a file always starts on a keyframe; anything before one is undecodable
      while (start < s.n && !s.sync[start]) start++;
      f.chunked = start;
    }
    const target = SEGMENT_TARGET_SEC * ts;
    while (start < s.n) {
      let end = start;
      let dur = 0;
      while (end < s.n) {
        let next = end + 1;
        while (next < s.n && !s.sync[next]) next++;
        if (next >= s.n && !f.final) break; // GOP still open
        for (let k = end; k < next; k++) dur += s.dur[k];
        end = next;
        if (dur >= target) break;
      }
      const ready = end > start && (dur >= target || (f.final && end === s.n));
      if (!ready) break;
      this.chunks.push({
        sn: this.nextSn++,
        file: f,
        from: start,
        to: end,
        dur,
        wall: f.ntpMs + (s.dts[start] / ts) * 1000,
        run: f.run,
      });
      this.targetDuration = Math.max(this.targetDuration, Math.round(dur / ts));
      start = end;
      f.chunked = end;
    }
  }

  // ------------------------------------------------------------ outputs

  /** The live playlist. With `skip`, segments older than CAN_SKIP_UNTIL from
   *  the live edge are replaced by EXT-X-SKIP (the player asks for that with
   *  _HLS_skip=YES once it has a full copy). */
  playlist(skip: boolean): string {
    const ch = this.chunks;
    const L = [
      "#EXTM3U",
      "#EXT-X-VERSION:9",
      `#EXT-X-TARGETDURATION:${this.targetDuration}`,
      `#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=${CAN_SKIP_UNTIL_SEC.toFixed(1)}`,
      `#EXT-X-MEDIA-SEQUENCE:${ch.length ? ch[0].sn : this.nextSn}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${ch.length ? ch[0].run.seq : 0}`,
      "#EXT-X-INDEPENDENT-SEGMENTS",
    ];
    let skipped = 0;
    if (skip && ch.length) {
      let total = 0;
      for (const c of ch) total += c.dur / c.run.timescale;
      const boundary = total - CAN_SKIP_UNTIL_SEC;
      let acc = 0;
      while (skipped < ch.length) {
        const d = ch[skipped].dur / ch[skipped].run.timescale;
        if (acc + d > boundary) break;
        acc += d;
        skipped++;
      }
      if (skipped > 0) L.push(`#EXT-X-SKIP:SKIPPED-SEGMENTS=${skipped}`);
    }
    for (let i = skipped; i < ch.length; i++) {
      const c = ch[i];
      const prev = i > 0 ? ch[i - 1] : null;
      const newRun = !prev || prev.run !== c.run;
      if (prev && newRun) L.push("#EXT-X-DISCONTINUITY");
      if (i === skipped || newRun) L.push(`#EXT-X-MAP:URI="init/${c.run.initKey}.mp4"`);
      // Wall clock on the first listed segment, at every session start and
      // at every file start (files re-anchor to MediaMTX's own clock).
      if (i === skipped || newRun || !prev || prev.file !== c.file) {
        L.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(c.wall).toISOString()}`);
      }
      // Six decimals: rounded durations would add up to seconds of drift
      // over 7 000 segments between the playlist timeline and the media.
      L.push(`#EXTINF:${(c.dur / c.run.timescale).toFixed(6)},`, `seg/${c.file.name}/${c.from}-${c.to}.m4s`);
    }
    // The camera stopped streaming (its last file is closed and untouched):
    // say so, and the player stops reloading a playlist that cannot change.
    // The page starts a new player when the camera comes back.
    if (this.ended()) L.push("#EXT-X-ENDLIST");
    return L.join("\n") + "\n";
  }

  /** True when the newest file is closed and nothing was written for
   *  STALE_MS: between two files of a live stream there is ~1 s without a
   *  newer file, so "closed" alone would end a live playlist. */
  ended(): boolean {
    const f = this.files.at(-1);
    return !!f && f.final && Date.now() - f.mtimeMs > STALE_MS;
  }

  /** What the timeline shows: recorded spans (ms), oldest and newest. */
  state() {
    const ranges: [number, number][] = [];
    for (const c of this.chunks) {
      const end = c.wall + (c.dur / c.run.timescale) * 1000;
      const lastRange = ranges.at(-1);
      if (lastRange && c.wall - lastRange[1] < 1000) lastRange[1] = Math.max(lastRange[1], end);
      else ranges.push([c.wall, end]);
    }
    return {
      epoch: this.epoch,
      ranges,
      from: ranges.length ? ranges[0][0] : null,
      until: ranges.length ? ranges[ranges.length - 1][1] : null,
      segments: this.chunks.length,
      targetDuration: this.targetDuration,
      ended: this.ended(),
    };
  }

  /** One media segment: samples [from, to) of a file as a single moof+mdat
   *  with the stream's own timestamps. Null when the range does not start on
   *  a keyframe of a file this index knows. */
  async segment(name: string, from: number, to: number): Promise<Buffer | null> {
    const f = this.file(name);
    if (!f) return null;
    const s = f.s;
    if (!(from >= 0 && to <= s.n && from < to && to - from <= MAX_SEGMENT_SAMPLES && s.sync[from])) return null;

    let total = 0;
    for (let k = from; k < to; k++) total += s.size[k];

    // one moof + mdat: mfhd, traf (tfhd default-base-is-moof, tfdt v1 with
    // the stream's own decode time, one trun with every frame)
    const n = to - from;
    const hasCto = !!s.cto && s.cto.subarray(from, to).some((c) => c !== 0);
    const entry = hasCto ? 16 : 12;
    const trunSize = 20 + n * entry;
    const trafSize = 8 + 16 + 20 + trunSize;
    const moofSize = 8 + 16 + trafSize;
    const out = Buffer.allocUnsafe(moofSize + 8 + total);

    // the frames, read straight into place after the boxes
    const fh = await open(path.join(this.dir, `${name}.mp4`), "r").catch(() => null);
    if (!fh) return null;
    try {
      let w = moofSize + 8;
      let k = from;
      while (k < to) {
        // samples of one part sit back to back: one read per part
        let j = k + 1;
        let len = s.size[k];
        while (j < to && s.off[j] === s.off[j - 1] + s.size[j - 1]) {
          len += s.size[j];
          j++;
        }
        const { bytesRead } = await fh.read(out, w, len, s.off[k]);
        if (bytesRead < len) return null;
        w += len;
        k = j;
      }
    } finally {
      await fh.close().catch(() => {});
    }

    let o = 0;
    o = out.writeUInt32BE(moofSize, o);
    o += out.write("moof", o, "latin1");
    o = out.writeUInt32BE(16, o);
    o += out.write("mfhd", o, "latin1");
    o = out.writeUInt32BE(0, o);
    o = out.writeUInt32BE(from + 1, o);
    o = out.writeUInt32BE(trafSize, o);
    o += out.write("traf", o, "latin1");
    o = out.writeUInt32BE(16, o);
    o += out.write("tfhd", o, "latin1");
    o = out.writeUInt32BE(0x020000, o);
    o = out.writeUInt32BE(f.info.trackId, o);
    o = out.writeUInt32BE(20, o);
    o += out.write("tfdt", o, "latin1");
    o = out.writeUInt32BE(0x01000000, o);
    o = out.writeBigUInt64BE(BigInt(f.baseTicks + s.dts[from]), o);
    o = out.writeUInt32BE(trunSize, o);
    o += out.write("trun", o, "latin1");
    // data offset, duration, size, flags (+ signed composition offset, v1)
    o = out.writeUInt32BE(hasCto ? 0x01000f01 : 0x00000701, o);
    o = out.writeUInt32BE(n, o);
    o = out.writeInt32BE(moofSize + 8, o);
    for (let k = from; k < to; k++) {
      o = out.writeUInt32BE(s.dur[k], o);
      o = out.writeUInt32BE(s.size[k], o);
      o = out.writeUInt32BE(s.sync[k] ? 0x02000000 : 0x01010000, o);
      if (hasCto) o = out.writeInt32BE(s.cto![k], o);
    }
    o = out.writeUInt32BE(total + 8, o);
    out.write("mdat", o, "latin1");
    return out;
  }
}

// ------------------------------------------------------- process-wide store

type Store = { cams: Map<string, CameraIndex> };
// On globalThis so every route bundle shares one index per camera (the dev
// server gives each route its own copy of this module). A hot reload keeps the
// old instance: restart the dev server after changing this file.
const G = globalThis as unknown as { __padelReplayIndexV1?: Store };

export async function replayIndex(camera: string, maxAgeMs = REFRESH_EVERY_MS): Promise<CameraIndex> {
  const store = (G.__padelReplayIndexV1 ??= { cams: new Map() });
  let c = store.cams.get(camera);
  if (!c) {
    c = new CameraIndex(camera);
    store.cams.set(camera, c);
  }
  return c.fresh(maxAgeMs);
}
