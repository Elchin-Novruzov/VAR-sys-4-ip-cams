/** Wall-clock helpers for the player. Everything is shown in the viewer's
 *  local time; the recorder stores UTC and the API speaks ISO 8601. */

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

export function fmtDateTime(ms: number): string {
  // Hand-rolled, not toLocaleString: Node and the browser resolve the default
  // locale differently, and a clip page renders this on both sides.
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
