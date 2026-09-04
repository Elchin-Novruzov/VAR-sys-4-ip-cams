import type { Segment } from "./types";

// MediaMTX HTTP endpoints, as reached from the Next.js server. Never exposed
// to the browser: every request goes through a route handler that first
// checks the session and that the camera path is one from config/courts.json.
const PLAYBACK_URL = (process.env.MEDIAMTX_PLAYBACK_URL ?? "http://127.0.0.1:9996").replace(/\/$/, "");
const HLS_URL = (process.env.MEDIAMTX_HLS_URL ?? "http://127.0.0.1:8888").replace(/\/$/, "");
const API_URL = (process.env.MEDIAMTX_API_URL ?? "http://127.0.0.1:9997").replace(/\/$/, "");

/** Basic auth for MediaMTX's HTTP listeners, only if the config gives the
 *  site a named user. By default the site is allowed by source IP instead
 *  (see authInternalUsers in infra/mediamtx.yml). */
function authHeaders(): Record<string, string> {
  const user = process.env.MEDIAMTX_READ_USER;
  const pass = process.env.MEDIAMTX_READ_PASS;
  if (!user || !pass) return {};
  return { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

/** Recorded timespans for one camera. MediaMTX: GET /list?path=&start=&end= */
export async function listSegments(cameraPath: string, start?: Date, end?: Date): Promise<Segment[]> {
  const u = new URL(`${PLAYBACK_URL}/list`);
  u.searchParams.set("path", cameraPath);
  if (start) u.searchParams.set("start", start.toISOString());
  if (end) u.searchParams.set("end", end.toISOString());
  const res = await fetch(u, { headers: authHeaders(), cache: "no-store" });
  // A camera that has never streamed has no recordings folder yet, and
  // MediaMTX answers that with 400 ("cannot find the path specified"), not
  // 404 -- measured on 2026-09-04 against the same binary. Both mean "nothing
  // recorded", which is a state the page shows, not a recorder failure. The
  // route above already rejects cameras that are not in courts.json, so a 400
  // here is never a bad path name.
  if (res.status === 404 || res.status === 400) return [];
  if (!res.ok) throw new Error(`mediamtx /list responded ${res.status}`);
  const rows = (await res.json()) as { start: string; duration: number }[];
  return rows.map((r) => ({ start: r.start, duration: r.duration }));
}

export type RecordingFormat = "fmp4" | "mp4";

/** MediaMTX: GET /get?path=&start=RFC3339&duration=seconds&format=fmp4|mp4 */
export function recordingUrl(
  cameraPath: string,
  start: Date,
  durationSec: number,
  format: RecordingFormat = "fmp4",
): URL {
  const u = new URL(`${PLAYBACK_URL}/get`);
  u.searchParams.set("path", cameraPath);
  u.searchParams.set("start", start.toISOString());
  u.searchParams.set("duration", durationSec.toFixed(3));
  u.searchParams.set("format", format);
  return u;
}

/** Streams a time range of one camera's recording. The caller owns the body. */
export async function fetchRecording(
  cameraPath: string,
  start: Date,
  durationSec: number,
  format: RecordingFormat = "fmp4",
): Promise<Response> {
  return fetch(recordingUrl(cameraPath, start, durationSec, format), {
    headers: authHeaders(),
    cache: "no-store",
  });
}

/** One file of the live HLS stream (index.m3u8, stream.m3u8, init.mp4, parts). */
export async function fetchHls(cameraPath: string, file: string, search: string): Promise<Response> {
  const u = new URL(`${HLS_URL}/${encodeURIComponent(cameraPath)}/${file}`);
  u.search = search;
  return fetch(u, { headers: authHeaders(), cache: "no-store" });
}

/** Which paths currently have a publisher, from the control API. */
export async function mediamtxStatus(): Promise<{ ok: boolean; publishing: string[] }> {
  try {
    const res = await fetch(`${API_URL}/v3/paths/list`, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return { ok: false, publishing: [] };
    const data = (await res.json()) as { items?: { name: string; ready: boolean }[] };
    return { ok: true, publishing: (data.items ?? []).filter((p) => p.ready).map((p) => p.name) };
  } catch {
    return { ok: false, publishing: [] };
  }
}
