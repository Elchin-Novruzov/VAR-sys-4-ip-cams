"use client";

import { useState } from "react";

/** Password input with a show/hide toggle inside the field. Plain form
 *  semantics are kept (name="password"), so the surrounding server-action
 *  form works unchanged. */
export function PasswordField({ name = "password", autoComplete = "current-password" }: { name?: string; autoComplete?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        name={name}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required
        className="w-full rounded-lg pl-3 pr-20 bg-transparent"
        style={{ border: "1px solid var(--line)" }}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? "hide password" : "show password"}
        className="absolute right-1 top-1 bottom-1 !min-h-0 text-xs px-3"
        style={{ background: "var(--panel-2)" }}
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
