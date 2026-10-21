import { NextResponse } from "next/server";
import { getCamera } from "@/lib/courts";
import { immutableBytes } from "@/lib/http";
import { RECORDING_NAME_RE, replayIndex } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** GET /api/replay/<camera>/seg/<recording file>/<from>-<to>.m4s
 *  Frames [from, to) of one recording file, starting on a keyframe, remuxed
 *  as one moof+mdat (lib/recordings.ts). The same URL always gives
 *  the same bytes, so the browser may cache it. */
export async function GET(_req: Request, ctx: { params: Promise<{ camera: string; file: string; range: string }> }) {
  const { camera, file, range } = await ctx.params;
  const m = /^(\d{1,6})-(\d{1,6})\.m4s$/.exec(range);
  if (!m || !RECORDING_NAME_RE.test(file) || !(await getCamera(camera))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // The playlist that named this segment refreshed the index; only a file
  // the index has not seen yet needs another look at the directory.
  let idx = await replayIndex(camera, 60_000);
  if (!idx.file(file)) idx = await replayIndex(camera, 0);
  const buf = await idx.segment(file, Number(m[1]), Number(m[2]));
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return immutableBytes(buf, "video/mp4");
}
