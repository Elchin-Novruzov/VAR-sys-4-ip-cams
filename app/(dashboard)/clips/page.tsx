import type { Metadata } from "next";
import { listClips, serializeClip } from "@/lib/clips";
import { isDbConfigured } from "@/lib/mongodb";
import { Ball } from "@/components/brand";
import { ClipCard } from "@/components/clip-card";

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
            <ClipCard clip={c} />
          </li>
        ))}
      </ul>
    </>,
  );
}
