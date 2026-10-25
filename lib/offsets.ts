/** Per-camera clock corrections, so cameras from different systems show the
 *  same moment side by side.
 *
 *  Why one is needed: a recording's wall clock is when the stream reached
 *  MediaMTX. The club's security cameras come camera -> NVR -> relay PC ->
 *  internet, the detector cameras camera -> detector PC (encode) -> internet,
 *  and the two paths differ by a second or more. A camera's offset is added
 *  to its recorded times: a camera whose picture arrives 1.4 s late gets
 *  -1400. Set from the replay page (Align), stored here, shared by everyone.
 *
 *  Server only. */

import { getDb, isDbConfigured } from "./mongodb";

type OffsetDoc = { _id: string; offsetMs: number; updatedAt: Date; updatedBy: string };

/** Largest correction accepted: anything bigger is a mistake, not a delay. */
export const MAX_OFFSET_MS = 30_000;
const CACHE_MS = 2000;

let cache: { at: number; map: Record<string, number> } | null = null;

async function collection() {
  return (await getDb()).collection<OffsetDoc>("camera_offsets");
}

/** All offsets (ms) by camera path; cameras without one are 0. */
export async function getOffsets(): Promise<Record<string, number>> {
  if (!isDbConfigured()) return {};
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  try {
    const docs = await (await collection()).find({}).toArray();
    const map: Record<string, number> = {};
    for (const d of docs) map[d._id] = d.offsetMs;
    cache = { at: Date.now(), map };
    return map;
  } catch {
    // the database being down must not take replay down: no corrections
    return cache?.map ?? {};
  }
}

export async function setOffset(path: string, offsetMs: number, by: string) {
  const ms = Math.round(Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, offsetMs)));
  await (await collection()).updateOne(
    { _id: path },
    { $set: { offsetMs: ms, updatedAt: new Date(), updatedBy: by } },
    { upsert: true },
  );
  cache = null;
  return ms;
}
