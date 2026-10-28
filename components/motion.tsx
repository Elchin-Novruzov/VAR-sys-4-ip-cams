"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PointerEvent, ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Ball } from "./brand";

/** The interactive pieces of the brand pages (motion). Kept out of the
 *  replay console on purpose: nothing here runs while someone is scrubbing. */

const LINKS = [
  { href: "/courts", label: "Courts" },
  { href: "/clips", label: "Clips" },
];

/** Header navigation; the lime pill slides to the page you open. */
export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-0.5">
      {LINKS.map((l) => {
        const on = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={on ? "page" : undefined}
            className={`relative flex items-center min-h-9 px-3 rounded-full display text-[1.15rem] sm:text-[1.25rem] pt-0.5 transition-colors ${
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
            <span className="relative">{l.label}</span>
          </Link>
        );
      })}
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
