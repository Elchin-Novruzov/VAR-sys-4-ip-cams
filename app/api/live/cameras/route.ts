import { NextResponse } from "next/server";
import { getCourt, liveCameras } from "@/lib/courts";

export const dynamic = "force-dynamic";

/** GET /api/live/cameras?court=<slug> -> { cameras: [path, ...] }
 *  The cameras the live page should show right now. The page asks every few
 *  seconds, so the detector PC's high-speed cameras join (and leave) an open
 *  page by themselves when a run starts or stops. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("court") ?? "";
  const court = await getCourt(slug);
  if (!court) return NextResponse.json({ error: "unknown court" }, { status: 404 });
  const cameras = (await liveCameras(court)).map((c) => c.path);
  return NextResponse.json({ cameras }, { headers: { "Cache-Control": "no-store" } });
}
