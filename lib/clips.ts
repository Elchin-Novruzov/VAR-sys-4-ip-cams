import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import { getCourt } from "./courts";
import { fetchRecording } from "./mediamtx";
import type { ClipDoc, SerializedClip } from "./types";

export function clipsDir() {
  const d = process.env.CLIPS_DIR ?? "clips";
  return path.isAbsolute(d) ? d : path.join(/* turbopackIgnore: true */ process.cwd(), d);
}

/** Absolute path of one camera's file inside a clip, or undefined if that
 *  camera is not part of the clip. Only doc data is used to build the path,
 *  so a request cannot escape the clips directory. */
export function clipFilePath(clip: ClipDoc, cameraPath: string): string | undefined {
  const cam = clip.cameras.find((c) => c.path === cameraPath);
  if (!cam || !clip._id) return undefined;
  return path.join(clipsDir(), clip._id.toHexString(), cam.file);
}

export type CreateClipInput = {
  courtSlug: string;
  start: Date;
  durationSec: number;
  label: string;
  createdBy: string;
};

/** Cut the same time range out of every camera of the court and keep it.
 *  The rolling buffer deletes itself after a few hours; a saved clip does not. */
export async function createClip(input: CreateClipInput): Promise<ClipDoc> {
  const court = await getCourt(input.courtSlug);
  if (!court) throw new Error("unknown court");

  const _id = new ObjectId();
  const dir = path.join(clipsDir(), _id.toHexString());
  await mkdir(dir, { recursive: true });

  const cameras: ClipDoc["cameras"] = [];
  for (const cam of court.cameras) {
    // Plain MP4 rather than fMP4: it downloads and shares cleanly from any player.
    const res = await fetchRecording(cam.path, input.start, input.durationSec, "mp4");
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) continue;
    const file = `${cam.path}.mp4`;
    await writeFile(path.join(dir, file), buf);
    cameras.push({ path: cam.path, label: cam.label, file, bytes: buf.byteLength });
  }
  if (cameras.length === 0) throw new Error("nothing recorded at that time");

  const doc: ClipDoc = {
    _id,
    courtSlug: input.courtSlug,
    label: input.label.trim() || "Saved moment",
    start: input.start,
    durationSec: input.durationSec,
    cameras,
    createdBy: input.createdBy,
    createdAt: new Date(),
    shareToken: randomBytes(12).toString("base64url"),
  };
  const db = await getDb();
  await db.collection<ClipDoc>("clips").insertOne(doc);
  return doc;
}

export async function listClips(limit = 200): Promise<ClipDoc[]> {
  const db = await getDb();
  return db.collection<ClipDoc>("clips").find({}, { sort: { createdAt: -1 }, limit }).toArray();
}

export async function getClip(id: string): Promise<ClipDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getDb();
  return db.collection<ClipDoc>("clips").findOne({ _id: new ObjectId(id) });
}

export async function getClipByToken(token: string): Promise<ClipDoc | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;
  const db = await getDb();
  return db.collection<ClipDoc>("clips").findOne({ shareToken: token });
}

export function serializeClip(c: ClipDoc): SerializedClip {
  return {
    id: c._id!.toHexString(),
    courtSlug: c.courtSlug,
    label: c.label,
    start: c.start.toISOString(),
    durationSec: c.durationSec,
    cameras: c.cameras.map(({ path: p, label, bytes }) => ({ path: p, label, bytes })),
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    shareToken: c.shareToken,
  };
}
