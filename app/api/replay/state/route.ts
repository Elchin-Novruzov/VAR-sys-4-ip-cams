import { NextResponse } from "next/server";
import { getCourt } from "@/lib/courts";
import { replayIndex } from "@/lib/recordings";
import { getOffsets } from "@/lib/offsets";

export const dynamic = "force-dynamic";

/** GET /api/replay/state?court=<slug>
 *  Per camera: the index epoch, the recorded spans (ms since epoch) and the
 *  newest recorded moment. Drives the replay timeline and tells the page when
 *  a camera starts or stops recording.
 *
 *  Spans are on the COURT clock: the camera's own recording times plus its
 *  offset (lib/offsets.ts), the same correction the page applies to the
 *  camera's playlist times, so every camera of the court lines up. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("court") ?? "";
  const court = await getCourt(slug);
  if (!court) return NextResponse.json({ error: "unknown court" }, { status: 404 });
  const offsets = await getOffsets();
  const cameras: Record<string, ReturnType<Awaited<ReturnType<typeof replayIndex>>["state"]> & { offsetMs: number }> = {};
  for (const cam of court.cameras) {
    const s = (await replayIndex(cam.path)).state();
    const off = offsets[cam.path] ?? 0;
    cameras[cam.path] = {
      ...s,
      ranges: s.ranges.map(([a, b]) => [a + off, b + off] as [number, number]),
      from: s.from === null ? null : s.from + off,
      until: s.until === null ? null : s.until + off,
      offsetMs: off,
    };
  }
  return NextResponse.json({ now: Date.now(), cameras }, { headers: { "Cache-Control": "no-store" } });
}
