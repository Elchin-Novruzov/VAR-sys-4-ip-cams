import Link from "next/link";
import { listClips, serializeClip } from "@/lib/clips";
import { isDbConfigured } from "@/lib/mongodb";
import { fmtBytes, fmtDateTime, fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ClipsPage() {
  if (!isDbConfigured()) {
    return (
      <div className="p-4 space-y-2">
        <h1 className="text-xl font-semibold">Saved clips</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No database configured. Set MONGODB_URI to keep saved moments; replay and live work without it.
        </p>
      </div>
    );
  }

  let clips;
  try {
    clips = (await listClips()).map(serializeClip);
  } catch (e) {
    return (
      <div className="p-4 space-y-2">
        <h1 className="text-xl font-semibold">Saved clips</h1>
        <p className="text-sm" style={{ color: "#fca5a5" }}>
          Database unreachable: {(e as Error).message}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Saved clips</h1>
      {clips.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Nothing saved yet. Press “Save this moment” in a court replay.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clips.map((c) => (
          <li key={c.id} className="rounded-2xl p-4" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
            <Link href={`/clips/${c.id}`} className="block space-y-1">
              <div className="font-semibold">{c.label}</div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                {fmtDateTime(new Date(c.start).getTime())} · {fmtDuration(c.durationSec)} · {c.courtSlug}
              </div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {c.cameras.map((cam) => `${cam.label} ${fmtBytes(cam.bytes)}`).join(" · ")}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
