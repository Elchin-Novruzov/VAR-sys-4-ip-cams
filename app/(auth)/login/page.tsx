import type { Metadata } from "next";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PasswordField } from "@/components/password-field";
import { CourtArt, Logo, Marquee } from "@/components/brand";
import { DraggableBall } from "@/components/motion";

export const metadata: Metadata = { title: "Sign in" };

const FEATURES = ["Both ends on one clock", "Frame by frame", "Slow motion", "Pinch zoom", "Share the moment"];
const TICKER = ["Replay", "Slow motion", "Frame by frame", "Zoom", "Save the moment", "Padel Center Baku"];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const target = (formData.get("callbackUrl") as string) || "/courts";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        // "on" when the box is ticked; auth.ts turns this into a 30-day token
        remember: formData.get("remember") === "on" ? "true" : "false",
        redirectTo: target,
      });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect(`/login?error=1&callbackUrl=${encodeURIComponent(target)}`);
      }
      throw e;
    }
  }

  return (
    <main className="stage relative min-h-dvh flex flex-col" style={{ overflowX: "clip" }}>
      {/* the court behind everything, tipped back like a broadcast camera sees it */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[8%] flex justify-center opacity-[0.22] lg:opacity-30">
        <div style={{ perspective: "1100px" }} className="w-[150%] sm:w-[110%] lg:w-[78%] max-w-[1200px] shrink-0">
          <div style={{ transform: "rotateX(48deg)", transformOrigin: "50% 35%" }}>
            <CourtArt className="w-full" />
          </div>
        </div>
      </div>

      <div className="relative z-10 flex-1 w-full max-w-6xl mx-auto grid lg:grid-cols-[1.15fr_1fr] items-center gap-6 lg:gap-12 short:grid-cols-2 short:items-start px-5 sm:px-10 pt-[max(2rem,env(safe-area-inset-top))] pb-8">
        <section className="space-y-5 text-center lg:text-left short:text-left short:space-y-3">
          <div className="eyebrow rise">
            <span className="hidden sm:inline">Padel Center Baku · </span>Official court replay
          </div>
          <h1 className="display text-[clamp(3rem,10vw,7.25rem)] short:!text-[3.4rem]">
            <span className="block rise" style={{ ["--d" as string]: "80ms" }}>
              Every point.
            </span>
            <span className="block rise text-[var(--accent)]" style={{ ["--d" as string]: "180ms" }}>
              Every angle.
            </span>
          </h1>
          <p className="hidden sm:block short:!hidden rise muted text-lg max-w-xl mx-auto lg:mx-0" style={{ ["--d" as string]: "280ms" }}>
            Rewind, slow down and zoom in on both ends of the court. When a point is disputed, watch it again.
          </p>
          <ul className="hidden lg:flex flex-wrap gap-2 rise" style={{ ["--d" as string]: "380ms" }}>
            {FEATURES.map((f) => (
              <li key={f} className="pill pill-quiet !text-[0.8rem] !py-1.5 !px-3">
                {f}
              </li>
            ))}
          </ul>
          <div className="hidden lg:block pt-2 rise" style={{ ["--d" as string]: "480ms" }}>
            <DraggableBall />
          </div>
        </section>

        <form
          action={login}
          className="glass rise w-full max-w-md mx-auto rounded-[2rem] p-6 sm:p-8 space-y-5 short:!p-5 short:!space-y-3 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
          style={{ ["--d" as string]: "200ms" }}
        >
          <div className="space-y-4">
            <Logo height={44} />
            <div>
              <h2 className="display text-4xl">Sign in</h2>
              <p className="text-sm muted">Staff login for the court replay.</p>
            </div>
          </div>
          {error && (
            <p className="alert text-sm rounded-xl px-3 py-2" role="alert">
              Wrong email or password.
            </p>
          )}
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/courts"} />
          <label className="block text-sm space-y-1.5">
            <span className="muted">Email</span>
            <input name="email" type="email" autoComplete="username" inputMode="email" required className="field" />
          </label>
          <label className="block text-sm space-y-1.5">
            <span className="muted">Password</span>
            <PasswordField />
          </label>
          <label className="flex items-center gap-3 text-sm py-1 cursor-pointer muted">
            <input name="remember" type="checkbox" className="h-5 w-5" />
            <span>
              Keep me signed in for 30 days
              <span className="block text-xs opacity-70">Otherwise the session ends after 8 hours.</span>
            </span>
          </label>
          <button type="submit" className="btn btn-accent group w-full text-base !min-h-12">
            Sign in
            <ArrowRight className="icon transition-transform group-hover:translate-x-1" aria-hidden />
          </button>
        </form>
      </div>

      <Marquee items={TICKER} className="relative z-10 py-4 border-t border-[var(--line)]" />
    </main>
  );
}
