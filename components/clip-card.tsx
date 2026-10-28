import Link from "next/link";
import { ArrowUpRight, Clapperboard } from "lucide-react";
import type { SerializedClip } from "@/lib/types";
import { fmtBytes, fmtDateTime, fmtDuration } from "@/lib/time";

/** One saved moment in a list (the clips page, "recently saved" on the
 *  courts page). Server component. */
export function ClipCard({ clip: c }: { clip: SerializedClip }) {
  return (
    <Link href={`/clips/${c.id}`} className="card card-hover group flex gap-4 p-4 h-full">
      <span className="grid place-items-center h-12 w-12 shrink-0 rounded-2xl bg-[var(--accent-2)] text-[var(--accent)] transition-transform group-hover:-rotate-6 group-hover:scale-105">
        <Clapperboard className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-start gap-2">
          <span className="font-semibold leading-snug flex-1 min-w-0 break-words">{c.label || "Saved moment"}</span>
          <ArrowUpRight
            className="icon muted shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:!text-[var(--accent)]"
            aria-hidden
          />
        </span>
        <span className="block text-sm muted">
          {fmtDateTime(new Date(c.start).getTime())} · {fmtDuration(c.durationSec)} · {c.courtSlug}
        </span>
        <span className="flex flex-wrap gap-1 pt-1">
          {c.cameras.map((cam) => (
            <span key={cam.path} className="pill pill-quiet !font-medium !text-[0.7rem]">
              {cam.label} · {fmtBytes(cam.bytes)}
            </span>
          ))}
        </span>
      </span>
    </Link>
  );
}
