/** Cutting an fMP4 byte stream into what Media Source Extensions want: the
 *  initialization segment (ftyp + moov) once, then whole media segments
 *  (moof + mdat) as they arrive. MediaMTX's playback server writes exactly
 *  that layout (one moof/mdat pair per second of video), so a window can be
 *  fed to a SourceBuffer while it is still downloading instead of being
 *  played from a blob once the last byte is in.
 *
 *  Pure byte work, no DOM: also runs under Node for a quick check. */

const td = new TextDecoder("latin1");

export type Box = { type: string; start: number; end: number; header: number };

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** Size and type of the box starting at b[o], if the header is complete.
 *  `size` is the whole box including its header. */
function header(b: Uint8Array, o: number, end: number): { size: number; type: string; header: number } | null {
  if (o + 8 > end) return null;
  let size = u32(b, o);
  let h = 8;
  if (size === 1) {
    if (o + 16 > end) return null;
    // 64-bit size; the high word is zero for anything we will ever see
    size = u32(b, o + 12) + u32(b, o + 8) * 2 ** 32;
    h = 16;
  } else if (size === 0) {
    size = end - o; // "to the end of the file"
  }
  if (size < h) return null;
  return { size, type: td.decode(b.subarray(o + 4, o + 8)), header: h };
}

/** Boxes laid side by side in b[start, end). A box whose size runs past `end`
 *  is not returned (the caller waits for more bytes). */
export function boxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const out: Box[] = [];
  let p = start;
  for (;;) {
    const h = header(b, p, end);
    if (!h || p + h.size > end) break;
    out.push({ type: h.type, start: p, end: p + h.size, header: h.header });
    p += h.size;
  }
  return out;
}

function child(b: Uint8Array, parent: Box, type: string, skip = 0): Box | undefined {
  return boxes(b, parent.start + parent.header + skip, parent.end).find((x) => x.type === type);
}

const hex = (n: number) => n.toString(16).padStart(2, "0");

/** The RFC 6381 codec string for the first video track of an initialization
 *  segment, e.g. `avc1.640020` or `hvc1.1.6.L150.B0`. Null when there is no
 *  video track we understand. */
export function videoCodec(init: Uint8Array): string | null {
  const moov = boxes(init).find((x) => x.type === "moov");
  if (!moov) return null;
  for (const trak of boxes(init, moov.start + moov.header, moov.end).filter((x) => x.type === "trak")) {
    const mdia = child(init, trak, "mdia");
    const minf = mdia && child(init, mdia, "minf");
    const stbl = minf && child(init, minf, "stbl");
    const stsd = stbl && child(init, stbl, "stsd");
    if (!stsd) continue;
    // stsd: full box (4) + entry count (4), then sample entries
    for (const entry of boxes(init, stsd.start + stsd.header + 8, stsd.end)) {
      // visual sample entry: 78 bytes of fixed fields before the child boxes
      if (entry.type === "avc1" || entry.type === "avc3") {
        const c = child(init, entry, "avcC", 78);
        if (!c) return null;
        const p = c.start + c.header;
        // configurationVersion, AVCProfileIndication, profile_compatibility, AVCLevelIndication
        return `${entry.type}.${hex(init[p + 1])}${hex(init[p + 2])}${hex(init[p + 3])}`;
      }
      if (entry.type === "hvc1" || entry.type === "hev1") {
        const c = child(init, entry, "hvcC", 78);
        if (!c) return null;
        const p = c.start + c.header;
        const b1 = init[p + 1];
        const space = b1 >> 6;
        const tier = (b1 >> 5) & 1;
        const profile = b1 & 0x1f;
        // general_profile_compatibility_flags, bit-reversed, as hex
        let compat = u32(init, p + 2);
        let rev = 0;
        for (let i = 0; i < 32; i++) {
          rev = (rev << 1) | (compat & 1);
          compat >>>= 1;
        }
        const level = init[p + 12];
        const cons: string[] = [];
        for (let i = 0; i < 6; i++) cons.push(hex(init[p + 6 + i]).toUpperCase());
        while (cons.length > 1 && cons[cons.length - 1] === "00") cons.pop();
        return `${entry.type}.${["", "A", "B", "C"][space]}${profile}.${(rev >>> 0).toString(16).toUpperCase()}.${tier ? "H" : "L"}${level}.${cons.join(".")}`;
      }
    }
  }
  return null;
}

/** Feeds bytes in any chunking; hands back the init segment once and every
 *  complete moof+mdat pair. Unknown top-level boxes ride along with the
 *  segment that follows them. Bytes are copied once, when a box is
 *  complete, so a 64 KB network chunk costs 64 KB of work. */
export class Fmp4Splitter {
  private parts: Uint8Array[] = [];
  private len = 0;
  /** Boxes of the group being assembled (ftyp+moov, or moof+mdat). */
  private group: Uint8Array[] = [];
  private initDone = false;
  /** Total bytes accepted so far. */
  bytes = 0;

  /** The first n queued bytes, without consuming them. */
  private peek(n: number): Uint8Array | null {
    if (this.len < n) return null;
    if (this.parts[0].length >= n) return this.parts[0].subarray(0, n);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of this.parts) {
      const take = Math.min(n - o, p.length);
      out.set(p.subarray(0, take), o);
      o += take;
      if (o === n) break;
    }
    return out;
  }

  /** Consumes and returns the first n queued bytes. */
  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let o = 0;
    let used = 0; // parts consumed whole, dropped in one splice at the end
    while (o < n) {
      const p = this.parts[used];
      const take = Math.min(n - o, p.length);
      out.set(p.subarray(0, take), o);
      o += take;
      if (take === p.length) used++;
      else this.parts[used] = p.subarray(take);
    }
    if (used) this.parts.splice(0, used);
    this.len -= n;
    return out;
  }

  private joinGroup(): Uint8Array {
    if (this.group.length === 1) return this.group[0];
    const out = new Uint8Array(this.group.reduce((a, g) => a + g.length, 0));
    let o = 0;
    for (const g of this.group) {
      out.set(g, o);
      o += g.length;
    }
    return out;
  }

  push(chunk: Uint8Array): { init?: Uint8Array; segments: Uint8Array[] } {
    this.bytes += chunk.length;
    if (chunk.length) {
      this.parts.push(chunk);
      this.len += chunk.length;
    }
    const out: { init?: Uint8Array; segments: Uint8Array[] } = { segments: [] };
    for (;;) {
      const head = this.peek(16);
      if (!head) break;
      const h = header(head, 0, 16) ?? header(head, 0, 8);
      if (!h || this.len < h.size) break;
      const box = this.take(h.size);
      this.group.push(box);
      if (!this.initDone) {
        if (h.type === "moov") {
          out.init = this.joinGroup();
          this.group = [];
          this.initDone = true;
        }
      } else if (h.type === "mdat") {
        out.segments.push(this.joinGroup());
        this.group = [];
      }
    }
    return out;
  }

  /** Bytes held back: an incomplete box, or a moof still waiting for its
   *  mdat. Useless to a decoder on their own; dropped when the stream ends. */
  get pending(): number {
    return this.len + this.group.reduce((a, g) => a + g.length, 0);
  }
}
