import { NextResponse } from "next/server";
import { getCamera } from "@/lib/courts";
import { listSegments } from "@/lib/mediamtx";

export const dynamic = "force-dynamic";

/** GET /api/video/segments?camera=court1-north[&start=ISO&end=ISO]
 *  What the rolling buffer currently holds for one camera. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const camera = sp.get("camera") ?? "";
  if (!(await getCamera(camera))) {
    return NextResponse.json({ error: "unknown camera" }, { status: 404 });
  }
  const start = sp.get("start") ? new Date(sp.get("start")!) : undefined;
  const end = sp.get("end") ? new Date(sp.get("end")!) : undefined;
  try {
    const segments = await listSegments(camera, start, end);
    return NextResponse.json(
      { camera, segments, serverTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
