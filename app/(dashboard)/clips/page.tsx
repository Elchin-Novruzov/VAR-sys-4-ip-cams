import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clapperboard } from "lucide-react";
import { listClips, serializeClip } from "@/lib/clips";
import { isDbConfigured } from "@/lib/mongodb";
import { fmtBytes, fmtDateTime, fmtDuration } from "@/lib/time";
import { Ball } from "@/components/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Saved moments" };

function Heading() {
  return (
    <div className="space-y-1">
      <div className="eyebrow rise">Padel Center Baku · VAR</div>
      <h1 className="display text-6xl sm:text-7xl rise" style={{ ["--d" as string]: "60ms" }}>
        Saved moments
      </h1>
    </div>
  );
}

export default async function ClipsPage() {
  const frame = (children: React.ReactNode) => (
    <div className="stage min-h-[calc(100dvh-var(--app-header))]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">{children}</div>
    </div>
  );

  if (!isDbConfigured()) {
    return frame(
      <>
        <Heading />
        <p className="text-sm muted">
          No database configured. Set MONGODB_URI to keep saved moments; replay and live work without it.
        </p>
      </>,
    );
  }

  let clips;
  try {
    clips = (await listClips()).map(serializeClip);
  } catch (e) {
    return frame(
      <>
        <Heading />
        <p className="alert text-sm rounded-xl px-3 py-2">Database unreachable: {(e as Error).message}</p>
      </>,
    );
  }

  return frame(
    <>
      <Heading />
      {clips.length === 0 && (
        <div className="card rise p-8 sm:p-12 text-center space-y-3" style={{ ["--d" as string]: "140ms" }}>
          <Ball size={56} className="mx-auto" />
          <h2 className="display text-3xl">Nothing saved yet</h2>
          <p className="text-sm muted">Press “Save” in a court replay to keep a moment here and share it.</p>
        </div>
      )}
      <ul className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clips.map((c, i) => (
          <li key={c.id} className="rise" style={{ ["--d" as string]: `${120 + Math.min(i, 12) * 50}ms` }}>
            <Link href={`/clips/${c.id}`} className="card card-hover group flex gap-4 p-4 h-full">
              <span className="grid place-items-center h-12 w-12 shrink-0 rounded-2xl bg-[var(--accent-2)] text-[var(--accent)]">
                <Clapperboard className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-start gap-2">
                  <span className="font-semibold leading-snug flex-1 min-w-0 break-words">{c.label}</span>
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
          </li>
        ))}
      </ul>
    </>,
  );
}
