import { NextResponse } from "next/server";
import { getCamera } from "@/lib/courts";
import { immutableBytes } from "@/lib/http";
import { replayIndex } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** GET /api/replay/<camera>/init/<key>.mp4 -- the init section (ftyp + moov,
 *  video track only) of one recording session; `key` is its content hash. */
export async function GET(_req: Request, ctx: { params: Promise<{ camera: string; key: string }> }) {
  const { camera, key } = await ctx.params;
  const m = /^([0-9a-f]{16})\.mp4$/.exec(key);
  if (!m || !(await getCamera(camera))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const idx = await replayIndex(camera, 60_000);
  const init = idx.init(m[1]);
  if (!init) return NextResponse.json({ error: "not found" }, { status: 404 });
  return immutableBytes(init, "video/mp4");
}
