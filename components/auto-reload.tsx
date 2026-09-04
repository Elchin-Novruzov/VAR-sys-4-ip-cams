"use client";

import { useEffect } from "react";

/** Reloads the page when the server runs a newer build than this tab.
 *  A courtside phone or home-screen tablet keeps one page open for days;
 *  backgrounded tabs and bfcache restores never refetch, so without this
 *  they show old code until someone clears site data. Checks when the app
 *  comes back to the foreground, and every few minutes while visible. */
export function AutoReload() {
  useEffect(() => {
    let known: string | null = null;
    let stop = false;

    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok || stop) return;
        const { id } = (await res.json()) as { id: string };
        if (known === null) {
          known = id;
          return;
        }
        if (id === known) return;
        // never yank a running replay out from under the referee
        const busy = [...document.querySelectorAll("video")].some((v) => !v.paused && !v.ended);
        if (!busy) window.location.reload();
      } catch {
        // offline or server restarting: try again on the next trigger
      }
    };

    void check();
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check();
    };
    const every = setInterval(onVisible, 5 * 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stop = true;
      clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
