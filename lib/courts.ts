import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CameraConfig, CourtConfig, CourtsFile } from "./types";

let cache: { mtimeMs: number; courts: CourtConfig[] } | undefined;

function courtsPath() {
  const f = process.env.COURTS_FILE ?? "config/courts.json";
  // The ignore comment keeps Turbopack from tracing the whole project as a
  // dependency of this one runtime-resolved file.
  return path.isAbsolute(f) ? f : path.join(/* turbopackIgnore: true */ process.cwd(), f);
}

/** Courts and cameras are deployment configuration, not user data, so they
 *  live in a checked-in JSON file rather than the database. The file is
 *  re-read when it changes, so an edit does not need a restart. */
export async function getCourts(): Promise<CourtConfig[]> {
  const p = courtsPath();
  const st = await stat(p);
  if (cache && cache.mtimeMs === st.mtimeMs) return cache.courts;
  const parsed = JSON.parse(await readFile(p, "utf8")) as CourtsFile;
  cache = { mtimeMs: st.mtimeMs, courts: parsed.courts };
  return parsed.courts;
}

export async function getCourt(slug: string): Promise<CourtConfig | undefined> {
  return (await getCourts()).find((c) => c.slug === slug);
}

/** Every camera path the site is allowed to touch. Route handlers refuse
 *  anything else, so a crafted URL cannot reach an arbitrary MediaMTX path. */
export async function getCamera(
  cameraPath: string,
): Promise<{ court: CourtConfig; camera: CameraConfig } | undefined> {
  for (const court of await getCourts()) {
    const camera = court.cameras.find((c) => c.path === cameraPath);
    if (camera) return { court, camera };
  }
  return undefined;
}
