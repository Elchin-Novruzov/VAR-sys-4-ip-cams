import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Deployment doctor. Reports which required env vars exist — presence only,
 *  never values (AUTH_URL is the public site address, not a secret). Excluded
 *  from the auth middleware in proxy.ts so it still answers when a missing
 *  AUTH_SECRET makes every other route 500. */
export async function GET() {
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
      node: process.version,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
