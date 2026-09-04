import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { PasswordField } from "@/components/password-field";

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
    <main className="min-h-dvh flex items-center justify-center p-6">
      <form
        action={login}
        className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <div>
          <h1 className="text-2xl font-semibold">Padel VAR</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Sign in to open the court replay.
          </p>
        </div>
        {error && (
          <p className="text-sm rounded-lg px-3 py-2" style={{ background: "#3b1114", color: "#fca5a5" }}>
            Wrong email or password.
          </p>
        )}
        <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/courts"} />
        <label className="block text-sm space-y-1">
          <span style={{ color: "var(--muted)" }}>Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            className="w-full rounded-lg px-3 bg-transparent"
            style={{ border: "1px solid var(--line)" }}
          />
        </label>
        <label className="block text-sm space-y-1">
          <span style={{ color: "var(--muted)" }}>Password</span>
          <PasswordField />
        </label>
        <label className="flex items-center gap-3 text-sm py-1 cursor-pointer" style={{ color: "var(--muted)" }}>
          <input name="remember" type="checkbox" className="h-5 w-5 accent-sky-400" />
          <span>
            Keep me signed in for 30 days
            <span className="block text-xs opacity-70">Otherwise the session ends after 8 hours.</span>
          </span>
        </label>
        <button type="submit" className="w-full font-medium" style={{ background: "var(--accent)", color: "#06202b" }}>
          Sign in
        </button>
      </form>
    </main>
  );
}
