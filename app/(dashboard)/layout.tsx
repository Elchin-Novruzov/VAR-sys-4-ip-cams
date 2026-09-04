import Link from "next/link";
import { auth, signOut } from "@/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header
        className="app-header sticky top-0 z-20 flex items-center gap-3 px-3 sm:px-4"
        style={{
          height: "var(--app-header)",
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <Link href="/courts" className="font-semibold tracking-tight">
          Padel VAR
        </Link>
        <nav className="flex gap-1 text-sm">
          <Link href="/courts" className="px-3 py-2 rounded-lg hover:bg-white/5">
            Courts
          </Link>
          <Link href="/clips" className="px-3 py-2 rounded-lg hover:bg-white/5">
            Clips
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm" style={{ color: "var(--muted)" }}>
          <span className="hidden sm:inline">{session?.user?.email}</span>
          <form action={logout}>
            <button type="submit" className="text-sm !min-h-9">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
