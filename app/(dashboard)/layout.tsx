import Link from "next/link";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { Ball, Logo } from "@/components/brand";
import { NavLinks } from "@/components/motion";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header
        className="app-header sticky top-0 z-20 flex items-center gap-2 sm:gap-4 px-3 sm:px-5"
        style={{ height: "var(--app-header)", paddingTop: "env(safe-area-inset-top)" }}
      >
        <Link href="/courts" className="flex items-center gap-2.5 shrink-0" aria-label="Padel Center Baku VAR, courts">
          {/* the full logo from a small tablet up, the ball alone on a phone */}
          <Ball size={30} className="sm:hidden" />
          <Logo height={30} className="hidden sm:block" />
          <span className="display text-[0.95rem] leading-none px-2 pt-[0.2rem] pb-[0.1rem] rounded-md bg-[var(--accent)] text-[var(--on-accent)]">
            VAR
          </span>
        </Link>
        <span className="hidden sm:block h-6 w-px bg-[var(--line)]" aria-hidden />
        <NavLinks />
        <div className="ml-auto flex items-center gap-3 text-sm muted">
          <span className="hidden md:inline truncate max-w-56">{session?.user?.email}</span>
          <form action={logout}>
            <button type="submit" className="btn btn-ghost !min-h-9 !px-3 text-sm" aria-label="Sign out" title="Sign out">
              <LogOut className="icon" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
