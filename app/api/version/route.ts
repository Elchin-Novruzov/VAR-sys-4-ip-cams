import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Changes whenever a new build is deployed (BUILD_ID) or, in dev, when the
 *  server restarts. AutoReload polls this so long-lived courtside pages pick
 *  up new code without anyone clearing site data. Public: leaks only a hash. */
const bootId = String(Date.now());

export async function GET() {
  let id = bootId;
  if (process.env.NODE_ENV === "production") {
    // an old `next build` can leave a BUILD_ID behind, so dev sticks to bootId
    try {
      id = (await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
    } catch {}
  }
  return NextResponse.json({ id }, { headers: { "Cache-Control": "no-store" } });
}
