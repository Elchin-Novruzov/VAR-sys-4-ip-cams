import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { recordingsDir } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** Deployment doctor. Reports which required env vars exist — presence only,
 *  never values (AUTH_URL is the public site address, not a secret). Excluded
 *  from the auth middleware in proxy.ts so it still answers when a missing
 *  AUTH_SECRET makes every other route 500. */
export async function GET() {
  // The replay buffer: can the site see the media server's recordings?
  // (Docker: the recordings volume mounted read-only into the web container.)
  // Files per camera folder; null = folder missing or unreadable.
  const dir = recordingsDir();
  let cameras: Record<string, number> | null = null;
  try {
    cameras = {};
    for (const c of await readdir(dir)) {
      cameras[c] = (await readdir(path.join(dir, c)).catch(() => [])).filter((f) => f.endsWith(".mp4")).length;
    }
  } catch {
    cameras = null;
  }
  return NextResponse.json(
    {
      ok: true,
      env: {
        AUTH_SECRET: !!process.env.AUTH_SECRET,
        AUTH_URL: process.env.AUTH_URL ?? null,
        MONGODB_URI: !!process.env.MONGODB_URI,
        MEDIAMTX_PLAYBACK_URL: !!process.env.MEDIAMTX_PLAYBACK_URL,
        MEDIAMTX_HLS_URL: !!process.env.MEDIAMTX_HLS_URL,
        MEDIAMTX_API_URL: !!process.env.MEDIAMTX_API_URL,
      },
      recordings: { dir, cameras },
      node: process.version,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
