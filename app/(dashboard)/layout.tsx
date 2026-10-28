import Link from "next/link";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { getCourts } from "@/lib/courts";
import { Ball, Logo } from "@/components/brand";
import { NavLinks } from "@/components/motion";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, courts] = await Promise.all([auth(), getCourts()]);
  // one court (the club today): Replay and Live open it directly
  const only = courts.length === 1 ? courts[0].slug : null;

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* the bar's height plus the status bar when the site runs full screen
          from the home screen (env(safe-area-inset-top), --chrome-top) */}
      <header
        className="app-header sticky top-0 z-20 flex items-center gap-2 sm:gap-4 px-3 sm:px-5"
        style={{ height: "var(--chrome-top)", paddingTop: "var(--safe-top)" }}
      >
        <Link href="/courts" className="flex items-center justify-center gap-2.5 shrink-0 min-h-10 min-w-10" aria-label="Padel Center Baku VAR, courts">
          {/* the full logo from a small tablet up, the ball alone on a phone */}
          <Ball size={30} className="sm:hidden" />
          <Logo height={30} className="hidden sm:block" />
          <span className="hidden min-[400px]:inline-block display text-[0.95rem] leading-none px-2 pt-[0.2rem] pb-[0.1rem] rounded-md bg-[var(--accent)] text-[var(--on-accent)]">
            VAR
          </span>
        </Link>
        <span className="hidden sm:block h-6 w-px bg-[var(--line)]" aria-hidden />
        <NavLinks replayHref={only ? `/courts/${only}` : "/courts"} liveHref={only ? `/courts/${only}/live` : "/courts"} />
        <div className="ml-auto flex items-center gap-3 text-sm muted">
          <span className="hidden xl:inline truncate max-w-56">{session?.user?.email}</span>
          <form action={logout}>
            <button type="submit" className="btn btn-ghost !min-h-10 !px-3 text-sm" aria-label="Sign out" title="Sign out">
              <LogOut className="icon" aria-hidden />
              <span className="hidden lg:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
