"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PointerEvent, ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Clapperboard, History, LayoutGrid, Radio } from "lucide-react";
import { Ball } from "./brand";

/** The interactive pieces of the brand pages (motion). Kept out of the
 *  replay console on purpose: nothing here runs while someone is scrubbing. */

/** Header navigation: Courts, Replay, Live, Clips. The lime pill slides to
 *  the page you open. On a phone the tabs are icons and only the open one
 *  spells its name; from a tablet up every tab has its name. Replay and Live
 *  go straight to the court when the club has one, else to the court list. */
export function NavLinks({ replayHref, liveHref }: { replayHref: string; liveHref: string }) {
  const path = usePathname();
  const links = [
    { href: "/courts", label: "Courts", Icon: LayoutGrid, on: path === "/courts" },
    { href: replayHref, label: "Replay", Icon: History, on: /^\/courts\/[^/]+$/.test(path) },
    { href: liveHref, label: "Live", Icon: Radio, on: /^\/courts\/[^/]+\/live$/.test(path) },
    { href: "/clips", label: "Clips", Icon: Clapperboard, on: path === "/clips" || path.startsWith("/clips/") },
  ];
  return (
    <nav className="flex items-center gap-0.5 min-w-0">
      {links.map(({ href, label, Icon, on }) => (
        <Link
          key={label}
          href={href}
          aria-current={on ? "page" : undefined}
          aria-label={label}
          title={label}
          className={`relative flex items-center gap-1.5 min-h-10 px-2.5 sm:px-3 rounded-full display text-[1.15rem] sm:text-[1.25rem] transition-colors ${
            on ? "text-[var(--on-accent)]" : "hover:text-[var(--accent)]"
          }`}
        >
          {on && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-0 rounded-full"
              style={{ background: "var(--accent)" }}
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
            />
          )}
          <Icon className="relative h-4 w-4 shrink-0" aria-hidden strokeWidth={2.4} />
          <span className={`relative pt-0.5 ${on ? "" : "hidden md:inline"}`}>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** A card that leans toward the mouse, with a lime light following it.
 *  Mouse only: on a touch screen the card stays still. */
export function Tilt({ children, className = "", max = 4 }: { children: ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion();
  const rx = useSpring(0, { stiffness: 200, damping: 20 });
  const ry = useSpring(0, { stiffness: 200, damping: 20 });
  const gx = useMotionValue(50);
  const gy = useMotionValue(0);
  const light = useMotionTemplate`radial-gradient(26rem circle at ${gx}% ${gy}%, rgba(206, 255, 101, 0.09), transparent 45%)`;

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 2 * max);
    rx.set(-(py - 0.5) * 2 * max);
    gx.set(px * 100);
    gy.set(py * 100);
  };
  const leave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.div
      className={className}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1000 }}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: light }} />
      {children}
    </motion.div>
  );
}

/** The club's ball, floating; grab it and throw it, it rolls as it goes and
 *  springs back. */
export function DraggableBall({ size = 132 }: { size?: number }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-220, 220]);
  return (
    <motion.div
      animate={reduce ? undefined : { y: [0, -12, 0] }}
      transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
      style={{ width: size, height: size }}
    >
      <motion.div
        drag
        dragSnapToOrigin
        dragElastic={0.55}
        dragTransition={{ bounceStiffness: 260, bounceDamping: 11 }}
        whileHover={{ scale: 1.04 }}
        whileDrag={{ scale: 1.1 }}
        style={{ x, rotate, filter: "drop-shadow(0 18px 30px rgba(243, 234, 93, 0.25))" }}
        className="cursor-grab active:cursor-grabbing touch-none"
        title="Throw the ball"
      >
        <Ball size={size} className="pointer-events-none select-none" />
      </motion.div>
    </motion.div>
  );
}
