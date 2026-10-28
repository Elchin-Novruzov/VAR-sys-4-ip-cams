import type { Metadata } from "next";
import Link from "next/link";
import { History, Radio } from "lucide-react";
import { getCourts } from "@/lib/courts";
import { mediamtxStatus } from "@/lib/mediamtx";
import type { CameraConfig } from "@/lib/types";
import { CourtArt, Marquee } from "@/components/brand";
import { Tilt } from "@/components/motion";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Courts" };

const TICKER = ["Replay", "Slow motion", "Frame by frame", "Zoom", "Save the moment", "Padel Center Baku"];

export default async function CourtsPage() {
  const [courts, status] = await Promise.all([getCourts(), mediamtxStatus()]);
  const isLive = (c: CameraConfig) => status.publishing.includes(c.path);
  const solo = courts.length === 1;

  return (
    <div className="stage min-h-[calc(100dvh-var(--app-header))] flex flex-col">
      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <div className="eyebrow rise">Padel Center Baku · VAR</div>
            <h1 className="display text-6xl sm:text-7xl rise" style={{ ["--d" as string]: "60ms" }}>
              Courts
            </h1>
          </div>
          <span className={`pill rise ${status.ok ? "pill-ok" : "pill-bad"}`} style={{ ["--d" as string]: "120ms" }}>
            <span className={`dot ${status.ok ? "on" : "live"}`} />
            {status.ok ? "Media server online" : "Media server unreachable"}
          </span>
        </div>

        {/* one court (the club today): one wide card, the court beside its
            details from a laptop up; more courts: a grid of cards */}
        <div className={`grid gap-4 sm:gap-5 ${solo ? "" : "md:grid-cols-2 lg:grid-cols-3"}`}>
          {courts.map((court, i) => {
            const varCams = court.cameras.filter((c) => (c.group ?? "var") === "var");
            const detCams = court.cameras.filter((c) => c.group === "detector");
            const liveCount = court.cameras.filter(isLive).length;
            const [first, second] = varCams;
            return (
              <div key={court.slug} className="rise" style={{ ["--d" as string]: `${160 + i * 90}ms` }}>
                <Tilt
                  max={solo ? 1.5 : 4}
                  className={`card card-hover overflow-hidden ${solo ? "lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-center" : ""}`}
                >
                  <Link
                    href={`/courts/${court.slug}`}
                    className={`block relative p-3 pb-0 ${solo ? "lg:pb-3" : ""}`}
                    aria-label={`${court.name} replay`}
                  >
                    <div className="relative rounded-2xl overflow-hidden" style={{ background: "#0c1a10" }}>
                      <CourtArt
                        className="w-full block"
                        cams={{ left: !!first && isLive(first), right: !!second && isLive(second) }}
                      />
                      <span className={`pill absolute left-3 top-3 ${liveCount ? "pill-live" : "pill-quiet"} backdrop-blur`}>
                        <span className={`dot ${liveCount ? "live" : ""}`} />
                        {liveCount ? `${liveCount} of ${court.cameras.length} cameras live` : "No camera streaming"}
                      </span>
                    </div>
                  </Link>
                  <div className={`p-5 space-y-4 ${solo ? "lg:p-7" : ""}`}>
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="display text-4xl truncate">{court.name}</h2>
                        <div className="text-sm muted truncate">{court.club}</div>
                      </div>
                      <span className="pill pill-quiet shrink-0">{court.retentionHours} h replay</span>
                    </div>

                    <CameraList title="VAR cameras" cams={varCams} isLive={isLive} />
                    {detCams.length > 0 && <CameraList title="Detector cameras" cams={detCams} isLive={isLive} compact />}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Link href={`/courts/${court.slug}`} className="btn btn-accent">
                        <History className="icon" aria-hidden />
                        Replay
                      </Link>
                      <Link href={`/courts/${court.slug}/live`} className="btn btn-ghost">
                        <Radio className="icon" aria-hidden style={{ color: liveCount ? "var(--live)" : undefined }} />
                        Live
                      </Link>
                    </div>
                  </div>
                </Tilt>
              </div>
            );
          })}
        </div>
      </div>
      <Marquee items={TICKER} className="py-4 mt-4 border-t border-[var(--line)] opacity-70" />
    </div>
  );
}

function CameraList({
  title,
  cams,
  isLive,
  compact = false,
}: {
  title: string;
  cams: CameraConfig[];
  isLive: (c: CameraConfig) => boolean;
  compact?: boolean;
}) {
  const on = cams.filter(isLive).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="eyebrow !text-[0.66rem] !text-[color:var(--muted)]">{title}</span>
        <span className="muted tabular-nums">
          {on}/{cams.length} streaming
        </span>
      </div>
      <ul className={compact ? "flex flex-wrap gap-1.5" : "grid gap-1.5"}>
        {cams.map((cam) => {
          const live = isLive(cam);
          // inside the detector group the "Detector · " prefix says nothing
          const label = compact ? cam.label.replace(/^Detector\s*·\s*/, "") : cam.label;
          return (
            <li
              key={cam.path}
              className={
                compact
                  ? "pill pill-quiet !font-medium"
                  : "flex items-center gap-2.5 text-sm rounded-xl px-3 py-2 bg-white/[0.03] border border-[var(--line)]"
              }
              style={compact && live ? { color: "var(--text)", borderColor: "rgba(206,255,101,.3)" } : undefined}
            >
              <span className={`dot ${live ? "on" : ""}`} />
              <span className="truncate">{label}</span>
              {!compact && <span className="ml-auto text-xs muted">{live ? "streaming" : "no stream"}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
