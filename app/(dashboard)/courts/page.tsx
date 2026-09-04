import Link from "next/link";
import { getCourts } from "@/lib/courts";
import { mediamtxStatus } from "@/lib/mediamtx";

export const dynamic = "force-dynamic";

export default async function CourtsPage() {
  const [courts, status] = await Promise.all([getCourts(), mediamtxStatus()]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Courts</h1>
        <span
          className="text-xs px-2 py-1 rounded-full"
          style={{ background: status.ok ? "#0f2f1f" : "#3b1114", color: status.ok ? "#86efac" : "#fca5a5" }}
        >
          {status.ok ? "media server online" : "media server unreachable"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {courts.map((court) => (
          <div
            key={court.slug}
            className="rounded-2xl p-4 space-y-3"
            style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
          >
            <div>
              <div className="font-semibold">{court.name}</div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                {court.club} · replay window {court.retentionHours} h
              </div>
            </div>
            <ul className="text-sm space-y-1">
              {court.cameras.map((cam) => {
                const live = status.publishing.includes(cam.path);
                return (
                  <li key={cam.path} className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: live ? "var(--accent-2)" : "var(--danger)" }}
                    />
                    {cam.label}
                    <span style={{ color: "var(--muted)" }}>· {live ? "streaming" : "no stream"}</span>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-2">
              <Link
                href={`/courts/${court.slug}`}
                className="flex-1 text-center py-3 rounded-xl font-semibold"
                style={{ background: "var(--accent)", color: "#06202b" }}
              >
                Replay
              </Link>
              <Link
                href={`/courts/${court.slug}/live`}
                className="flex-1 text-center py-3 rounded-xl font-semibold"
                style={{ border: "1px solid var(--line)" }}
              >
                Live
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
