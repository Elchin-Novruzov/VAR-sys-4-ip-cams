import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, History, Radio, RotateCcw } from "lucide-react";
import { getCourts } from "@/lib/courts";
import { mediamtxStatus } from "@/lib/mediamtx";
import { countClips, listClips, serializeClip } from "@/lib/clips";
import { isDbConfigured } from "@/lib/mongodb";
import type { CameraConfig, SerializedClip } from "@/lib/types";
import { CourtArt, Marquee } from "@/components/brand";
import { ClipCard } from "@/components/clip-card";
import { CountUp, LiveClock, Reveal, ReviewSteps } from "@/components/control-room";
import { Tilt } from "@/components/motion";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Control room" };

const TICKER = ["Replay", "Mark the incident", "Rock it back and forth", "Slow motion", "Every angle", "Save the moment", "Padel Center Baku"];

const KEYS: { keys: string[]; what: string }[] = [
  { keys: ["Space"], what: "Play or pause" },
  { keys: ["J", "L"], what: "Ten seconds back / on" },
  { keys: ["←", "→"], what: "One frame" },
  { keys: ["M"], what: "Mark the incident" },
  { keys: ["R"], what: "Rock it back and forth" },
  { keys: ["O"], what: "Loop it" },
  { keys: ["[", "]"], what: "Previous / next incident" },
  { keys: ["S"], what: "Save the moment" },
  { keys: ["End"], what: "Back to live" },
];

/** The recent saved moments and their count; the page works without Mongo. */
async function savedMoments(): Promise<{ recent: SerializedClip[]; total: number } | null> {
  if (!isDbConfigured()) return null;
  try {
    const [recent, total] = await Promise.all([listClips(3), countClips()]);
    return { recent: recent.map(serializeClip), total };
  } catch {
    return null;
  }
}

export default async function CourtsPage() {
  const [courts, status, saved] = await Promise.all([getCourts(), mediamtxStatus(), savedMoments()]);
  const isLive = (c: CameraConfig) => status.publishing.includes(c.path);
  const solo = courts.length === 1;
  const allCams = courts.flatMap((c) => c.cameras);
  const liveCams = allCams.filter(isLive).length;
  const onAir = liveCams > 0;
  const maxFps = Math.max(25, ...allCams.map((c) => c.fps));
  const hours = Math.max(...courts.map((c) => c.retentionHours), 0);

  return (
    <div className="stage min-h-[calc(100dvh-var(--app-header))] flex flex-col" style={{ overflowX: "clip" }}>
      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-10 sm:space-y-14">
        {/* ---- hero: the room's name, and its on-air panel ---- */}
        <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div className="space-y-2">
            <div className="eyebrow rise">Padel Center Baku · VAR</div>
            <h1 className="display text-[clamp(3.6rem,11vw,6.5rem)] rise" style={{ ["--d" as string]: "60ms" }}>
              Control <span className="text-[var(--accent)]">room</span>
            </h1>
            <p className="muted max-w-xl rise" style={{ ["--d" as string]: "140ms" }}>
              Replay any moment of the last {hours} hours from both ends of the court, mark the incident, rock it back
              and forth, and save it for the players.
            </p>
          </div>

          <div className="card p-4 sm:p-5 rise" style={{ ["--d" as string]: "200ms" }}>
            <div className="flex items-center justify-between gap-3">
              <span className={`pill ${onAir ? "pill-live" : "pill-quiet"}`}>
                <span className={`dot ${onAir ? "live" : ""} ${onAir ? "rec" : ""}`} />
                {onAir ? "On air · recording" : "Off air"}
              </span>
              <div className={`meter ${onAir ? "on" : ""}`} aria-hidden>
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="flex items-end justify-between gap-3 pt-3">
              <div>
                <div className="eyebrow !text-[0.62rem] !text-[color:var(--muted)]">Court time · Baku</div>
                <LiveClock className="display text-5xl sm:text-6xl leading-none" />
              </div>
              <div className="text-right text-sm">
                <div className={status.ok ? "text-[var(--ok-text)]" : "text-[var(--danger-text)]"}>
                  {status.ok ? "Media server online" : "Media server unreachable"}
                </div>
                <div className="muted tabular-nums">
                  {liveCams}/{allCams.length} cameras streaming
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- the courts ---- */}
        <section className="space-y-4">
          <SectionHead eyebrow="Choose a court" title="Courts" />
          <div className={`grid gap-4 sm:gap-5 ${solo ? "" : "md:grid-cols-2 lg:grid-cols-3"}`}>
            {courts.map((court, i) => {
              const varCams = court.cameras.filter((c) => (c.group ?? "var") === "var");
              const detCams = court.cameras.filter((c) => c.group === "detector");
              const liveCount = court.cameras.filter(isLive).length;
              const [first, second] = varCams;
              return (
                <div key={court.slug} className="rise" style={{ ["--d" as string]: `${240 + i * 90}ms` }}>
                  <Tilt
                    max={solo ? 1.5 : 4}
                    className={`card card-hover overflow-hidden ${liveCount ? "on-air" : ""} ${solo ? "lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-center" : ""}`}
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
                      {/* one tap to the last seconds, already playing */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs muted pr-1">Instant replay</span>
                        {[10, 30, 60].map((s) => (
                          <Link key={s} href={`/courts/${court.slug}?back=${s}`} className="btn btn-ghost !min-h-9 !px-3 text-sm flex-1">
                            <RotateCcw className="icon" aria-hidden />
                            {s} s
                          </Link>
                        ))}
                      </div>
                    </div>
                  </Tilt>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---- the numbers ---- */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Stat label="Cameras streaming" value={liveCams} suffix={`/${allCams.length}`} delay={0} />
          <Stat label="Hours of replay" value={hours} suffix="h" delay={0.08} />
          <Stat label="Saved moments" value={saved?.total ?? 0} delay={0.16} />
          <Stat label="Frames a second, top camera" value={maxFps} suffix="fps" delay={0.24} />
        </section>

        {/* ---- how a review works ---- */}
        <section className="space-y-5">
          <Reveal>
            <SectionHead eyebrow="How a review works" title="Four taps to the truth" />
          </Reveal>
          <ReviewSteps />
          <Reveal>
            <p className="text-sm muted text-center">
              The players decide. The replay shows them what happened, from every angle.
            </p>
          </Reveal>
        </section>

        {/* ---- recently saved ---- */}
        {saved && saved.recent.length > 0 && (
          <section className="space-y-4">
            <Reveal className="flex items-end justify-between gap-3">
              <SectionHead eyebrow="Saved moments" title="Recently saved" />
              <Link href="/clips" className="btn btn-ghost !min-h-10 text-sm group shrink-0">
                See all
                <ArrowRight className="icon transition-transform group-hover:translate-x-1" aria-hidden />
              </Link>
            </Reveal>
            <ul className="grid gap-3 sm:gap-4 md:grid-cols-3">
              {saved.recent.map((c, i) => (
                <li key={c.id}>
                  <Reveal delay={i * 0.08} className="h-full">
                    <ClipCard clip={c} />
                  </Reveal>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---- keyboard: for the desk, not the phone ---- */}
        <section className="hidden md:block">
          <Reveal className="card p-6 space-y-5">
            <SectionHead eyebrow="At the desk" title="Pro controls" />
            <ul className="grid grid-cols-3 gap-x-6 gap-y-3">
              {KEYS.map((k) => (
                <li key={k.what} className="kbd-row flex items-center gap-3">
                  <span className="flex gap-1 shrink-0">
                    {k.keys.map((key) => (
                      <kbd key={key} className="kbd">
                        {key}
                      </kbd>
                    ))}
                  </span>
                  <span className="text-sm muted">{k.what}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>
      </div>
      <Marquee items={TICKER} className="py-4 mt-10 border-t border-[var(--line)] opacity-70" />
    </div>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="space-y-1">
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="display text-4xl sm:text-5xl">{title}</h2>
    </div>
  );
}

function Stat({ label, value, suffix, delay }: { label: string; value: number; suffix?: string; delay: number }) {
  return (
    <Reveal delay={delay} className="card p-4 sm:p-5 overflow-hidden">
      <div className="display text-5xl sm:text-6xl leading-none">
        <CountUp to={value} />
        {suffix && <span className="text-[var(--accent)] text-3xl sm:text-4xl pl-1">{suffix}</span>}
      </div>
      <div className="text-xs sm:text-sm muted pt-2">{label}</div>
    </Reveal>
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
