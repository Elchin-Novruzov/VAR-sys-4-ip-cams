import { NextResponse } from "next/server";
import { getCamera } from "@/lib/courts";
import { fetchHls } from "@/lib/mediamtx";

export const dynamic = "force-dynamic";

/** GET /api/video/hls/<camera>/<file>
 *  Proxies the live HLS playlist and its parts. MediaMTX writes relative
 *  URLs inside the playlists, and this route keeps the same shape, so they
 *  resolve back through the proxy unchanged. */
export async function GET(req: Request, ctx: { params: Promise<{ camera: string; file: string[] }> }) {
  const { camera, file } = await ctx.params;
  if (!(await getCamera(camera))) {
    return NextResponse.json({ error: "unknown camera" }, { status: 404 });
  }
  const name = file.join("/");
  if (!/^[A-Za-z0-9_.\-/]+$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "bad file" }, { status: 400 });
  }
  const upstream = await fetchHls(camera, name, new URL(req.url).search);
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  }
  const fallback = name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4";
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? fallback,
      "Cache-Control": "no-store",
    },
  });
}
