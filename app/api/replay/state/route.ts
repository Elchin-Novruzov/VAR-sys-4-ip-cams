import { NextResponse } from "next/server";
import { getCourt } from "@/lib/courts";
import { replayIndex } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** GET /api/replay/state?court=<slug>
 *  Per camera: the index epoch, the recorded spans (ms since epoch) and the
 *  newest recorded moment. Drives the replay timeline and tells the page when
 *  a camera starts or stops recording. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("court") ?? "";
  const court = await getCourt(slug);
  if (!court) return NextResponse.json({ error: "unknown court" }, { status: 404 });
  const cameras: Record<string, ReturnType<Awaited<ReturnType<typeof replayIndex>>["state"]>> = {};
  for (const cam of court.cameras) cameras[cam.path] = (await replayIndex(cam.path)).state();
  return NextResponse.json({ now: Date.now(), cameras }, { headers: { "Cache-Control": "no-store" } });
}
