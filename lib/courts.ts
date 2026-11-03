import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { mediamtxStatus } from "./mediamtx";
import { recordingsDir } from "./recordings";
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
async function configuredCourts(): Promise<CourtConfig[]> {
  const p = courtsPath();
  const st = await stat(p);
  if (cache && cache.mtimeMs === st.mtimeMs) return cache.courts;
  const parsed = JSON.parse(await readFile(p, "utf8")) as CourtsFile;
  cache = { mtimeMs: st.mtimeMs, courts: parsed.courts };
  return parsed.courts;
}

/** The in/out system's high-speed cameras publish as `<court>-det-<camera
 *  name>`, named by the detector PC (padel_analytics: live_multi.py --var,
 *  the Court Control app). The kit goes to other courts with other cameras,
 *  so their names are not all in config/courts.json: any such camera that is
 *  publishing now, or has recordings in the buffer, is one of that court's
 *  cameras. The listed ones keep their labels. infra/mediamtx.yml accepts
 *  the same names (its `~^court[0-9]+-det-` path). */
export const DETECTOR_PATH_RE = /^(.+?)-det-([a-z0-9][a-z0-9_-]{0,23})$/;
const DETECTOR_SEEN_MS = 5000;
let detectorsSeen: { at: number; paths: string[] } | undefined;

async function detectorPaths(): Promise<string[]> {
  if (detectorsSeen && Date.now() - detectorsSeen.at < DETECTOR_SEEN_MS) return detectorsSeen.paths;
  const [{ publishing }, folders] = await Promise.all([
    mediamtxStatus(),
    readdir(recordingsDir()).catch(() => [] as string[]),
  ]);
  const paths = [...new Set([...publishing, ...folders])].filter((p) => DETECTOR_PATH_RE.test(p)).sort();
  detectorsSeen = { at: Date.now(), paths };
  return paths;
}

function withDetectors(court: CourtConfig, paths: string[]): CourtConfig {
  const listed = new Set(court.cameras.map((c) => c.path));
  const extra: CameraConfig[] = [];
  for (const p of paths) {
    const m = DETECTOR_PATH_RE.exec(p);
    if (m && m[1] === court.slug && !listed.has(p)) {
      extra.push({ path: p, label: `Detector · ${m[2]}`, fps: 60, group: "detector" });
    }
  }
  return extra.length ? { ...court, cameras: [...court.cameras, ...extra] } : court;
}

/** Every court with its cameras: the listed ones plus the detector cameras
 *  seen in the last few seconds. */
export async function getCourts(): Promise<CourtConfig[]> {
  const [courts, detectors] = await Promise.all([configuredCourts(), detectorPaths()]);
  return detectors.length ? courts.map((c) => withDetectors(c, detectors)) : courts;
}

export async function getCourt(slug: string): Promise<CourtConfig | undefined> {
  return (await getCourts()).find((c) => c.slug === slug);
}

/** The live page's cameras: the club's always (a dead one says so on its
 *  tile), a detector camera only while the detector PC publishes it. */
export async function liveCameras(court: CourtConfig): Promise<CameraConfig[]> {
  const { publishing } = await mediamtxStatus();
  return court.cameras.filter((c) => (c.group ?? "var") === "var" || publishing.includes(c.path));
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
