"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** Password input with a show/hide toggle inside the field. Plain form
 *  semantics are kept (name="password"), so the surrounding server-action
 *  form works unchanged. */
export function PasswordField({ name = "password", autoComplete = "current-password" }: { name?: string; autoComplete?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input name={name} type={shown ? "text" : "password"} autoComplete={autoComplete} required className="field !pr-14" />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? "hide password" : "show password"}
        title={shown ? "Hide password" : "Show password"}
        className="absolute right-1 top-1 bottom-1 !min-h-0 !px-3 grid place-items-center muted hover:!text-[var(--accent)]"
        style={{ background: "transparent", border: "none" }}
      >
        {shown ? <EyeOff className="icon" aria-hidden /> : <Eye className="icon" aria-hidden />}
      </button>
    </div>
  );
}
