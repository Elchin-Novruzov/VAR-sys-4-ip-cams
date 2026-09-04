import { NextResponse } from "next/server";
import { clipFilePath, getClipByToken } from "@/lib/clips";
import { serveFile } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/clips/shared/<token>/file?camera=<path>  (public; the token is the credential) */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const camera = new URL(req.url).searchParams.get("camera") ?? "";
  const clip = await getClipByToken(token).catch(() => null);
  if (!clip) return NextResponse.json({ error: "not found" }, { status: 404 });
  const p = clipFilePath(clip, camera);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  const name = `${clip.label}-${camera}.mp4`.replace(/[^\w.-]+/g, "_");
  return serveFile(req, p, "video/mp4", name);
}
