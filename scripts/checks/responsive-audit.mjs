// Phone and iPad audit of the VAR site with Playwright's device profiles
// (viewport = the visible area with the browser bars, touch, mobile
// emulation). Per page: sideways overflow, content cut off by its own
// container, tap targets under 32 px, replay console fit, save sheet fit.
// Run from a folder with playwright-core installed (scripts/checks/README.md).
// DEVICES / PAGES (comma-separated substrings) narrow the run.
import { createRequire } from "module";
const require = createRequire(process.cwd() + "/");
const { chromium, devices } = require("playwright-core");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? ".";
const SHOTS = process.env.SHOTS !== "0";

const ipad = (w, h) => ({ ...devices["iPad Pro 11"], viewport: { width: w, height: h } });
const ALL = {
  "iPhone SE": devices["iPhone SE"],
  "iPhone SE3": devices["iPhone SE (3rd gen)"],
  "iPhone 13": devices["iPhone 13"],
  "iPhone 15 Pro Max": devices["iPhone 15 Pro Max"],
  "Galaxy S8": devices["Galaxy S8"],
  "Pixel 7": devices["Pixel 7"],
  "iPhone SE3 land": devices["iPhone SE (3rd gen) landscape"],
  "iPhone 13 land": devices["iPhone 13 landscape"],
  "iPhone 15PM land": devices["iPhone 15 Pro Max landscape"],
  "Pixel 7 land": devices["Pixel 7 landscape"],
  "iPad Mini": devices["iPad Mini"],
  "iPad Mini land": devices["iPad Mini landscape"],
  "iPad Air": ipad(820, 1180),
  "iPad Air land": ipad(1180, 820),
  "iPad Pro 11": devices["iPad Pro 11"],
  "iPad Pro 11 land": devices["iPad Pro 11 landscape"],
  "iPad Pro 12.9": ipad(1024, 1366),
  "iPad Pro 12.9 land": ipad(1366, 1024),
};
const pick = (o, env) => (process.env[env] ? Object.fromEntries(Object.entries(o).filter(([k]) => process.env[env].split(",").some((f) => k.includes(f)))) : o);
const DEVICES = pick(ALL, "DEVICES");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = [];
try {
  const c0 = await browser.newContext();
  const p0 = await c0.newPage();
  await p0.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p0.fill('input[name="email"]', "dev@local");
  await p0.fill('input[name="password"]', "dev");
  await Promise.all([p0.waitForURL(/\/courts/), p0.click('button[type="submit"]')]);
  const state = await c0.storageState();
  await p0.goto(`${BASE}/clips`, { waitUntil: "networkidle" });
  const clip = await p0.locator('a[href^="/clips/"]').first().getAttribute("href").catch(() => null);
  let share = null;
  if (clip) {
    await p0.goto(`${BASE}${clip}`, { waitUntil: "networkidle" });
    const t = await p0.locator("text=Anyone with this link").textContent().catch(() => "");
    share = (t && t.match(/\/share\/[\w-]+/)?.[0]) ?? null;
  }
  await c0.close();

  const PAGES = pick(
    {
      login: ["/login", false],
      courts: ["/courts", true],
      replay: ["/courts/court1", true],
      live: ["/courts/court1/live", true],
      clips: ["/clips", true],
      ...(clip ? { clip: [clip, true] } : {}),
      ...(share ? { share: [share, false] } : {}),
      notfound: ["/nope", true],
    },
    "PAGES",
  );

  for (const [dname, dev] of Object.entries(DEVICES)) {
    for (const [pname, [path, authed]] of Object.entries(PAGES)) {
      const ctx = await browser.newContext({ ...dev, ...(authed ? { storageState: state } : {}) });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const steps = [["", null]];
      if (pname === "replay") {
        await page.waitForFunction(() => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0), null, { timeout: 30000 }).catch(() => {});
        steps.length = 0;
        steps.push(["", null], ["+mark", async () => page.getByRole("button", { name: "Mark incident" }).click()], ["+sheet", async () => page.getByRole("button", { name: /^Save/ }).first().click()]);
      }
      if (pname === "courts") {
        // scroll through so the reveals run, then back up
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < h; y += 400) {
          await page.evaluate((yy) => window.scrollTo(0, yy), y);
          await page.waitForTimeout(80);
        }
        await page.waitForTimeout(900);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      for (const [suffix, act] of steps) {
        if (act) {
          await act();
          await page.waitForTimeout(700);
        }
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const vh = innerHeight;
          const out = { overflowX: document.documentElement.scrollWidth - vw, clipped: [], small: [], scrollHidden: 0, truncated: [] };
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return null;
            const s = getComputedStyle(el);
            if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) return null;
            return r;
          };
          const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 28);
          for (const el of document.querySelectorAll("button, a, input, select, [role=slider], .pill, h1, h2, h3, .tile-label, .tile-badge, label, p, kbd")) {
            if (el.closest(".marquee")) continue;
            const r = visible(el);
            if (!r) continue;
            let clipped = r.left < -1 || r.right > vw + 1;
            let scroller = false;
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const s = getComputedStyle(a);
              if (s.overflowX === "auto" || s.overflowX === "scroll") {
                const ar = a.getBoundingClientRect();
                if (r.left < ar.left - 1 || r.right > ar.right + 1) scroller = true;
                break;
              }
              if (s.overflowX === "hidden" || s.overflowX === "clip") {
                const ar = a.getBoundingClientRect();
                if (r.left < ar.left - 1 || r.right > ar.right + 1) {
                  clipped = true;
                  break;
                }
              }
            }
            if (scroller) out.scrollHidden++;
            else if (clipped) out.clipped.push(name(el));
            const interactive = el.matches("button, a[href], input:not([type=hidden]), select, [role=slider]");
            if (interactive && (r.height < 31.5 || r.width < 31.5)) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          for (const el of document.querySelectorAll(".truncate")) {
            const r = visible(el);
            if (r && el.scrollWidth > el.clientWidth + 1) out.truncated.push(name(el));
          }
          const c = document.querySelector(".console") ?? document.querySelector(".live-page");
          if (c) {
            out.consoleOverflow = c.scrollHeight - c.clientHeight;
            const rows = [...c.querySelectorAll(".controls-row, .instant-row")];
            const last = rows[rows.length - 1];
            if (last) out.lastRowBottom = Math.round(last.getBoundingClientRect().bottom) - vh;
            const grid = c.querySelector(".tiles");
            if (grid) out.tilesH = Math.round(grid.getBoundingClientRect().height);
          }
          const sheet = document.querySelector(".sheet");
          if (sheet) {
            const r = sheet.getBoundingClientRect();
            out.sheet = { top: Math.round(r.top), over: Math.round(r.bottom - vh), scroll: sheet.scrollHeight - sheet.clientHeight };
          }
          return out;
        });
        const problems = [];
        if (r.overflowX > 0) problems.push(`page scrolls sideways by ${r.overflowX}px`);
        if (r.clipped.length) problems.push(`cut off: ${[...new Set(r.clipped)].slice(0, 6).join(" | ")}`);
        if (r.consoleOverflow > 0) problems.push(`screen content taller than the screen by ${r.consoleOverflow}px`);
        if (r.lastRowBottom > 0) problems.push(`last control row ${r.lastRowBottom}px below the screen`);
        if (r.sheet && (r.sheet.top < 0 || r.sheet.over > 0)) problems.push(`save sheet off screen (top ${r.sheet.top}, bottom +${r.sheet.over})`);
        const info = [];
        if (r.small.length) info.push(`small targets: ${[...new Set(r.small)].slice(0, 5).join(", ")}`);
        if (r.scrollHidden) info.push(`${r.scrollHidden} items behind a sideways scroll`);
        if (r.truncated.length) info.push(`truncated: ${[...new Set(r.truncated)].slice(0, 4).join(" | ")}`);
        if (r.tilesH !== undefined) info.push(`pictures ${r.tilesH}px`);
        if (errors.length) problems.push(`page errors: ${errors.slice(0, 2).join(" | ")}`);
        const label = `${dname} ${pname}${suffix}`;
        report.push({ label, problems, info });
        console.log(`${problems.length ? "FAIL" : "ok  "} ${label.padEnd(34)} ${problems.join("; ")}${info.length ? `  [${info.join("; ")}]` : ""}`);
        if (SHOTS) await page.screenshot({ path: `${OUT}/${dname.replace(/\W+/g, "_")}_${pname}${suffix.replace(/\W/g, "_")}.png` });
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
const fails = report.filter((r) => r.problems.length);
console.log(`\n${report.length} checks, ${fails.length} with problems`);
