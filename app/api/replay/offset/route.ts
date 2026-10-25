import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCourt } from "@/lib/courts";
import { MAX_OFFSET_MS, setOffset } from "@/lib/offsets";

export const dynamic = "force-dynamic";

/** PUT { court, camera, offsetMs } -- saves one camera's clock correction
 *  (lib/offsets.ts) for everyone. Staff and admins only: a wrong offset
 *  shows every viewer the wrong moment on that camera. */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "staff") return NextResponse.json({ error: "staff only" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { court?: unknown; camera?: unknown; offsetMs?: unknown } | null;
  const court = await getCourt(typeof body?.court === "string" ? body.court : "");
  const camera = typeof body?.camera === "string" ? body.camera : "";
  const offsetMs = Number(body?.offsetMs);
  if (!court || !court.cameras.some((c) => c.path === camera)) {
    return NextResponse.json({ error: "unknown court or camera" }, { status: 404 });
  }
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > MAX_OFFSET_MS) {
    return NextResponse.json({ error: `offset must be within ±${MAX_OFFSET_MS / 1000} s` }, { status: 400 });
  }
  try {
    const saved = await setOffset(camera, offsetMs, session.user.email ?? session.user.id ?? "?");
    return NextResponse.json({ camera, offsetMs: saved });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
