import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClip, listClips, serializeClip } from "@/lib/clips";
import { getCourt } from "@/lib/courts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const clips = await listClips();
    return NextResponse.json({ clips: clips.map(serializeClip) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

/** POST { courtSlug, start: ISO, durationSec, label } → cuts every camera of
 *  the court for that range and keeps the files. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { courtSlug?: unknown; start?: unknown; durationSec?: unknown; label?: unknown }
    | null;
  const courtSlug = typeof body?.courtSlug === "string" ? body.courtSlug : "";
  const start = new Date(typeof body?.start === "string" ? body.start : "");
  const durationSec = Number(body?.durationSec);
  const label = typeof body?.label === "string" ? body.label.slice(0, 80) : "";

  if (!(await getCourt(courtSlug))) return NextResponse.json({ error: "unknown court" }, { status: 404 });
  if (Number.isNaN(start.getTime()) || !(durationSec >= 2) || durationSec > 120) {
    return NextResponse.json({ error: "bad start or duration" }, { status: 400 });
  }

  try {
    const clip = await createClip({
      courtSlug,
      start,
      durationSec,
      label,
      createdBy: session.user.email ?? session.user.id,
    });
    return NextResponse.json({ clip: serializeClip(clip) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
