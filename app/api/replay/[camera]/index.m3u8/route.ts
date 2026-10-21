import { NextResponse } from "next/server";
import { getCamera } from "@/lib/courts";
import { textResponse } from "@/lib/http";
import { replayIndex } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** GET /api/replay/<camera>/index.m3u8?e=<epoch>[&_HLS_skip=YES]
 *  The whole replay buffer of one camera as a live HLS playlist (see
 *  lib/recordings.ts). `e` is the index epoch the player started with: when
 *  the server restarted its sequence numbers no longer match, and 410 tells
 *  the page to start the player again. */
export async function GET(req: Request, ctx: { params: Promise<{ camera: string }> }) {
  const { camera } = await ctx.params;
  if (!(await getCamera(camera))) {
    return NextResponse.json({ error: "unknown camera" }, { status: 404 });
  }
  const sp = new URL(req.url).searchParams;
  const idx = await replayIndex(camera);
  const e = sp.get("e");
  if (e && e !== idx.epoch) {
    return NextResponse.json(
      { error: "the replay index restarted", epoch: idx.epoch },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }
  const skip = sp.get("_HLS_skip") === "YES" || sp.get("_HLS_skip") === "v2";
  return textResponse(req, idx.playlist(skip), "application/vnd.apple.mpegurl");
}
