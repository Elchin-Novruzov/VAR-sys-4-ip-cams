import { NextResponse } from "next/server";
import { clipFilePath, getClip } from "@/lib/clips";
import { serveFile } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/clips/<id>/file?camera=<path>  (session required, see proxy.ts) */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const camera = new URL(req.url).searchParams.get("camera") ?? "";
  const clip = await getClip(id).catch(() => null);
  if (!clip) return NextResponse.json({ error: "not found" }, { status: 404 });
  const p = clipFilePath(clip, camera);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  const name = `${clip.label}-${camera}.mp4`.replace(/[^\w.-]+/g, "_");
  return serveFile(req, p, "video/mp4", name);
}
