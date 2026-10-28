"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { ArrowLeftRight, BookmarkPlus, Flag, Link2, RotateCcw, ScanEye } from "lucide-react";

/** The moving parts of the courts page, the club's VAR control room. */

// one shared one-second clock for every LiveClock on the page
const second = {
  subscribe(cb: () => void) {
    const id = setInterval(cb, 1000);
    return () => clearInterval(id);
  },
  now: () => Math.floor(Date.now() / 1000),
};

const BAKU = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Baku",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** The court's own clock (Baku time), ticking. Empty on the server: the
 *  server's second is not the viewer's. */
export function LiveClock({ className = "" }: { className?: string }) {
  const s = useSyncExternalStore(second.subscribe, second.now, () => null);
  return (
    <span className={`tabular-nums ${className}`} suppressHydrationWarning>
      {s === null ? "--:--:--" : BAKU.format(s * 1000)}
    </span>
  );
}

/** A number that counts up when it scrolls into view. */
export function CountUp({ to, className = "" }: { to: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const value = useMotionValue(0);
  const text = useTransform(value, (v) => String(Math.round(v)));
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      value.set(to);
      return;
    }
    const c = animate(value, to, { duration: 1.4, ease: [0.2, 0.7, 0.2, 1] });
    return () => c.stop();
  }, [inView, reduce, to, value]);
  return (
    <motion.span ref={ref} className={`tabular-nums ${className}`}>
      {text}
    </motion.span>
  );
}

/** Slides a section up into place the first time it scrolls into view. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

const STEPS = [
  {
    title: "Point in doubt?",
    text: "Tap ⟲ 10 s on the courtside tablet, or Instant replay on the live page. Both ends roll back together.",
    art: (
      <div className="relative grid place-items-center h-full">
        <RotateCcw className="demo-rewind h-10 w-10 text-[var(--accent)]" aria-hidden />
        <span className="absolute display text-[0.9rem] text-[var(--accent)] pt-0.5">10</span>
      </div>
    ),
  },
  {
    title: "Mark it, rock it",
    text: "Mark the incident, then loop it or rock it back and forth in slow motion, frame by frame.",
    art: (
      <div className="relative h-full flex items-center px-4">
        <div className="relative w-full h-3 rounded-full bg-[var(--panel-2)] border border-[var(--line)]">
          <div className="absolute inset-y-0 left-[30%] w-[34%] review-window rounded-sm" />
          <Flag className="absolute -top-6 left-[47%] h-4 w-4 text-[var(--ball)]" aria-hidden />
          <div className="demo-rock absolute -top-1.5 -bottom-1.5 w-1 -ml-0.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_rgba(206,255,101,0.8)]" />
        </div>
        <ArrowLeftRight className="absolute right-3 bottom-2 h-4 w-4 muted" aria-hidden />
      </div>
    ),
  },
  {
    title: "Every angle, one clock",
    text: "North and south ends, and the high-speed detector cameras when they run, all on the same moment. Pinch to zoom.",
    art: (
      <div className="h-full flex items-center justify-center gap-3">
        <div className="h-12 w-16 rounded-md border border-[var(--line-strong)] bg-[#0c1a10] grid place-items-center">
          <ScanEye className="h-5 w-5 muted" aria-hidden />
        </div>
        <div className="demo-sync h-0.5 w-8 bg-[var(--accent)] shadow-[0_0_8px_rgba(206,255,101,0.8)]" />
        <div className="h-12 w-16 rounded-md border border-[var(--line-strong)] bg-[#0c1a10] grid place-items-center">
          <ScanEye className="h-5 w-5 muted" aria-hidden />
        </div>
      </div>
    ),
  },
  {
    title: "Save the moment",
    text: "One tap keeps a clip from every camera, with a share link for the players.",
    art: (
      <div className="h-full grid place-items-center">
        <div className="demo-pop flex items-center gap-2 rounded-full px-3 py-1.5 bg-[var(--accent-2)] text-[var(--accent)] text-sm font-semibold">
          <BookmarkPlus className="h-4 w-4" aria-hidden />
          Saved
          <Link2 className="h-4 w-4" aria-hidden />
        </div>
      </div>
    ),
  },
];

/** "How a review works": four steps, a lime line that fills as the page
 *  scrolls through them (down the side on a phone, along the top on a
 *  bigger screen), each card rising in turn. */
export function ReviewSteps() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 55%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  return (
    <div ref={ref} className="relative">
      {/* the line: vertical on a phone, horizontal from md up */}
      <div className="md:hidden absolute left-[1.15rem] top-2 bottom-2 w-px bg-[var(--line)]" aria-hidden>
        <motion.div className="absolute inset-0 origin-top bg-[var(--accent)]" style={{ scaleY: progress }} />
      </div>
      <div className="hidden md:block absolute left-6 right-6 top-[1.15rem] h-px bg-[var(--line)]" aria-hidden>
        <motion.div className="absolute inset-0 origin-left bg-[var(--accent)]" style={{ scaleX: progress }} />
      </div>
      <ol className="relative grid gap-4 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.title}
            className="relative pl-12 md:pl-0 flex flex-col"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.6, delay: i * 0.12, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <span className="absolute left-0 md:static grid place-items-center h-[2.3rem] w-[2.3rem] rounded-full display text-xl pt-0.5 bg-[var(--bg)] border border-[var(--accent)] text-[var(--accent)] md:mb-4">
              {i + 1}
            </span>
            <div className="card p-4 space-y-3 flex-1">
              <div className="h-20 rounded-xl bg-black/30 border border-[var(--line)] overflow-hidden">{s.art}</div>
              <h3 className="display text-2xl">{s.title}</h3>
              <p className="text-sm muted">{s.text}</p>
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
