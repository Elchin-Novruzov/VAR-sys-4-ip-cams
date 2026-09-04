import { NextResponse } from "next/server";
import { getCamera } from "@/lib/courts";
import { fetchRecording, type RecordingFormat } from "@/lib/mediamtx";

export const dynamic = "force-dynamic";

/** Longest range the player may pull in one request. Keeps a bad URL from
 *  streaming the whole buffer. */
const MAX_DURATION_SEC = 180;

/** GET /api/video/get?camera=&start=ISO&duration=seconds[&format=fmp4|mp4]
 *  A time range of one camera's recording, streamed straight through from the
 *  media server. The browser plays it from a blob, so seeking and frame
 *  stepping are instant. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const camera = sp.get("camera") ?? "";
  if (!(await getCamera(camera))) {
    return NextResponse.json({ error: "unknown camera" }, { status: 404 });
  }
  const start = new Date(sp.get("start") ?? "");
  const duration = Number(sp.get("duration") ?? "0");
  const format: RecordingFormat = sp.get("format") === "mp4" ? "mp4" : "fmp4";
  if (Number.isNaN(start.getTime()) || !(duration > 0) || duration > MAX_DURATION_SEC) {
    return NextResponse.json({ error: "bad start or duration" }, { status: 400 });
  }

  const upstream = await fetchRecording(camera, start, duration, format);
  if (!upstream.ok || !upstream.body) {
    // 404 = no segment covers that time; 400 = the camera has never recorded
    // (no folder yet -- MediaMTX's answer, measured 2026-09-04). Both are
    // "nothing recorded", 404 to the client; anything else is the recorder.
    const status = upstream.status === 404 || upstream.status === 400 ? 404 : 502;
    return NextResponse.json({ error: `no recording for that time (${upstream.status})` }, { status });
  }
  const stamp = start.toISOString().replace(/[:.]/g, "-");
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${camera}-${stamp}.mp4"`,
    },
  });
}
