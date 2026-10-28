// Replay audit: drives the replay page in headless Chrome as a phone on a
// throttled line and checks what a referee would notice. Written 2026-10-21
// for the HLS replay rework (COMMIT_LOG); every number in that entry came from
// this script. See scripts/checks/README.md for how to run it.
//
// Steps: open (plays ~30 s before the newest moment) -> tap BACK_HOURS back on
// the "All" bar -> zoom 1m and drag back 20 s -> -10 three times -> pause,
// follower settles, five frame steps back (both cameras one frame each) ->
// play 10 s (follower not re-seeked) -> 0.25x -> replay last 10 s -> -1s x5
// inside played video -> heap, playlist traffic, no horizontal scroll.
//
// Environment:
//   BASE        site URL (default http://localhost:3000)
//   SESSION     authjs.session-token cookie (production builds: no dev login;
//               make one with mint-session.mjs). Without it: dev@local / dev.
//   COURT       court slug (default court1)
//   MBPS        throttled download speed (default 10, a phone on 4G)
//   VIEW        viewport WxH (default 390x844, a phone)
//   BACK_HOURS  how far back the far tap goes (default 1.5; the buffer must
//               reach that far)
//   SHOT        screenshot file (default replay-audit.png in the current folder)
//
// playwright-core is resolved from the CURRENT folder, not from this repo:
//   mkdir %TEMP%\pw && cd %TEMP%\pw && npm i playwright-core
//   node C:\path\to\var-replay\scripts\checks\replay-audit.mjs
// It drives the installed Chrome (channel "chrome"); no browser download.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const { chromium } = createRequire(pathToFileURL(`${process.cwd()}/`).href)("playwright-core");

const BASE = process.env.BASE ?? "http://localhost:3000";
const COURT = process.env.COURT ?? "court1";
const MBPS = Number(process.env.MBPS ?? 10);
const VIEW = (process.env.VIEW ?? "390x844").split("x").map(Number);
const BACK_HOURS = Number(process.env.BACK_HOURS ?? 1.5);
const SHOT = process.env.SHOT ?? "replay-audit.png";

const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const fails = [];
const check = (ok, what) => {
  if (!ok) fails.push(what);
  return ok ? "OK" : "FAIL";
};

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-precise-memory-info"] });
const ctx = await browser.newContext({
  viewport: { width: VIEW[0], height: VIEW[1] },
  deviceScaleFactor: 2,
  isMobile: VIEW[0] < 900,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  const bad = m.type() === "error" || (m.type() === "warning" && !/React DevTools/.test(m.text()));
  if (bad) errors.push(`${m.type()}: ${m.text()}`);
});

if (process.env.SESSION) {
  await ctx.addCookies([
    { name: "authjs.session-token", value: process.env.SESSION, domain: new URL(BASE).hostname, path: "/" },
  ]);
} else {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "dev@local");
  await page.fill('input[name="password"]', "dev");
  await Promise.all([page.waitForURL(/\/courts/), page.click('button[type="submit"]')]);
}

// network: throttle like a phone, count video and playlist bytes
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
let bytes = 0;
let plBytes = 0;
let segRequests = 0;
const urls = new Map();
cdp.on("Network.requestWillBeSent", (e) => {
  urls.set(e.requestId, e.request.url);
  if (e.request.url.includes("/seg/")) segRequests++;
});
cdp.on("Network.loadingFinished", (e) => {
  const u = urls.get(e.requestId) ?? "";
  if (u.includes("/seg/") || u.includes("/init/")) bytes += e.encodedDataLength;
  if (u.includes("index.m3u8")) plBytes += e.encodedDataLength;
});
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 60,
  downloadThroughput: (MBPS * 1e6) / 8,
  uploadThroughput: 2e6 / 8,
});
log(`viewport ${VIEW.join("x")}, ${MBPS} Mbps / 60 ms, ${BASE}`);

// ?debug exposes the players as window.__replay on production builds too
await page.goto(`${BASE}/courts/${COURT}?debug=1`);
// the dev server's corner badge sits over the bottom-left button on a phone
await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

/** What the screen shows. The clock (top strip) is the leading camera's
 *  moment; spinners are counted on the first tile only (the follower is
 *  measured on its own through frameTime). */
const st = () =>
  page.evaluate(() => {
    const tiles = [...document.querySelectorAll("div.relative.min-h-0.rounded-lg")];
    return {
      v: [...document.querySelectorAll("video")].map((x) => ({
        rs: x.readyState,
        seeking: x.seeking,
        paused: x.paused,
        w: x.videoWidth,
        rate: x.playbackRate,
      })),
      clock: (document.querySelector("[data-clock]") ?? document.querySelector("span.font-mono"))?.textContent ?? "",
      spinners: tiles[0] ? tiles[0].querySelectorAll('[aria-label="loading"]').length : 0,
    };
  });
const until = async (pred, ms) => {
  const s = Date.now();
  for (;;) {
    const x = await st();
    if (pred(x)) return { ok: true, ms: Date.now() - s, x };
    if (Date.now() - s > ms) return { ok: false, ms: Date.now() - s, x };
    await page.waitForTimeout(50);
  }
};
/** "12:50:08.45" -> ms of the day (comparisons only). */
const clockMs = (c) => {
  const m = /(\d+):(\d+):(\d+)\.(\d+)/.exec(c ?? "");
  return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] * 10 : NaN;
};
const asClock = (ms) => clockMs(new Date(ms).toLocaleTimeString([], { hour12: false }) + ".00");
const shown = (x) => x.v[0] && x.v[0].rs >= 2 && !x.v[0].seeking && x.v[0].w > 0;
const frames = () => page.evaluate(() => Object.values(window.__replay ?? {}).map((p) => p.frameTime));

const bar = page.locator('[role="slider"]');
const range = async () => {
  const a = await bar.evaluate((el) => [Number(el.getAttribute("aria-valuemin")), Number(el.getAttribute("aria-valuemax"))]);
  return { from: a[0], to: a[1] };
};

// 0. open
let r = await until((x) => shown(x) && !x.v[0].paused && x.clock.includes(":"), 60000);
log(`open: picture and playing after ${r.ms} ms; clock ${r.x.clock}; ${check(r.ok, "open plays")}`);
let { from, to } = await range();
const opened = clockMs(r.x.clock) - asClock(to - 30000);
log(`  opened ${(opened / 1000).toFixed(1)} s from "30 s before the newest moment"; ${check(Math.abs(opened) < 5000, "opens 30 s before newest")}`);
let box = await bar.boundingBox();
log(`bar (All): ${((to - from) / 3600e3).toFixed(2)} h on ${box.width.toFixed(0)} px = ${((to - from) / 1000 / box.width).toFixed(0)} s per pixel`);

// 1. far tap on the All bar
bytes = 0;
const target = to - BACK_HOURS * 3600e3;
let s0 = Date.now();
await page.mouse.click(box.x + ((target - from) / (to - from)) * box.width, box.y + box.height / 2);
r = await until((x) => shown(x) && Math.abs(clockMs(x.clock) - asClock(target)) < 60000 && x.spinners === 0, 30000);
log(`tap ${BACK_HOURS} h back: picture after ${Date.now() - s0} ms at ${r.x.clock}, playing=${!r.x.v[0].paused}, ${(bytes / 1e6).toFixed(1)} MB; ${check(r.ok, "far tap shows picture")}`);
const farClock = clockMs(r.x.clock);

// 2. zoom to one minute, drag the playhead back 20 s
await page.getByRole("button", { name: "1m", exact: true }).click();
await page.waitForTimeout(300);
box = await bar.boundingBox();
const pxPerSec = box.width / 60;
const headX = await page.evaluate(() => {
  const b = document.querySelector('[role="slider"] .rounded-full').getBoundingClientRect();
  return b.x + b.width / 2;
});
await page.evaluate(() => {
  window.__seeks = [0, 0];
  document.querySelectorAll("video").forEach((v, i) => v.addEventListener("seeking", () => window.__seeks[i]++));
});
bytes = 0;
s0 = Date.now();
await page.mouse.move(headX, box.y + box.height / 2);
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(headX - i * pxPerSec, box.y + box.height / 2);
  await page.waitForTimeout(50);
}
await page.mouse.up();
r = await until((x) => shown(x) && x.spinners === 0 && Math.abs(clockMs(x.clock) - (farClock - 20000)) < 2500, 30000);
log(`drag back 20 s at 1m zoom: picture at ${r.x.clock} after ${Date.now() - s0} ms from drag start (the drag takes ~1 s), ${(bytes / 1e6).toFixed(1)} MB, seeks ${JSON.stringify(await page.evaluate(() => window.__seeks))}; ${check(r.ok, "drag back 20 s")}`);

// 3. -10 three times, into video that is not downloaded yet
for (let i = 0; i < 3; i++) {
  const before = clockMs((await st()).clock);
  bytes = 0;
  s0 = Date.now();
  await page.getByRole("button", { name: "−10", exact: true }).click();
  r = await until((x) => shown(x) && x.spinners === 0 && Math.abs(clockMs(x.clock) - (before - 10000)) < 1500, 20000);
  log(`  −10 #${i + 1}: picture at ${r.x.clock} after ${Date.now() - s0} ms, ${(bytes / 1e6).toFixed(2)} MB; ${check(r.ok, "minus 10")}`);
}

// 4. pause; the follower must land on the leader's frame; five frame steps back
await page.getByRole("button", { name: /^(Play|Pause)$/ }).click();
await until((x) => x.v[0].paused, 5000);
await page.waitForTimeout(300); // the on-screen clock updates every 100 ms
{
  const s1 = Date.now();
  let gap = Infinity;
  while (Date.now() - s1 < 5000) {
    const f = await frames();
    gap = Math.abs(f[1] - f[0]);
    if (gap < 0.045) break;
    await page.waitForTimeout(50);
  }
  log(`  follower on the leader's frame ${Date.now() - s1} ms after the pause (gap ${(gap * 1000).toFixed(0)} ms); ${check(gap < 0.045, "follower settles after jumps")}`);
}
let prev = clockMs((await st()).clock);
let prevF = (await frames())[0];
const steps = [];
const moved = [];
for (let i = 0; i < 5; i++) {
  s0 = Date.now();
  await page.getByRole("button", { name: /^(◀|back one frame)$/ }).click();
  r = await until((x) => shown(x) && clockMs(x.clock) < prev - 20, 5000);
  const c = clockMs(r.x.clock);
  await page.waitForTimeout(120);
  const f = await frames();
  steps.push(`${Date.now() - s0 - 120}ms`);
  moved.push([Math.round((f[0] - prevF) * 1000), Math.round((f[1] - f[0]) * 1000)]);
  prev = c;
  prevF = f[0];
}
const oneFrame = moved.every(([mv, gap]) => mv <= -35 && mv >= -45 && Math.abs(gap) <= 45);
log(`5 frame steps back: ${steps.join(" ")}; frame moved / follower minus leader (ms): ${moved.map((m) => m.join("/")).join(" ")}; ${check(oneFrame, "frame steps are one frame, both cameras")}`);

// 5. play 10 s: the follower is kept in step by small speed changes, not seeks
await page.evaluate(() => (window.__seeks = [0, 0]));
await page.getByRole("button", { name: /^(Play|Pause)$/ }).click();
await page.waitForTimeout(10000);
const sk = await page.evaluate(() => window.__seeks);
r = await st();
log(`play 10 s: seeks leader=${sk[0]} follower=${sk[1]}; rates ${r.v.map((x) => x.rate.toFixed(2)).join("/")}; ${check(sk[1] <= 2, "follower not re-seeked constantly")}`);

// 6. slow motion
await page.getByRole("button", { name: "0.25×", exact: true }).click();
const c1 = clockMs((await st()).clock);
await page.waitForTimeout(4000);
const c2 = clockMs((await st()).clock);
log(`0.25× for 4 s: clock advanced ${((c2 - c1) / 1000).toFixed(2)} s; ${check(Math.abs((c2 - c1) / 1000 - 1) < 0.35, "slow motion rate")}`);
await page.getByRole("button", { name: "1×", exact: true }).click();

// 7. replay the last 10 s from far away
bytes = 0;
s0 = Date.now();
await page.getByRole("button", { name: /^(⟲ )?10s$/ }).click();
({ from, to } = await range());
r = await until(
  (x) => shown(x) && !x.v[0].paused && x.spinners === 0 && Math.abs(clockMs(x.clock) - asClock(to - 10000)) < 4000,
  30000,
);
log(`⟲ 10s from far back: playing at ${r.x.clock} after ${Date.now() - s0} ms, ${(bytes / 1e6).toFixed(1)} MB; ${check(r.ok, "replay last 10 s")}`);

// 8. after 8 s of play, -1s five times: inside played video, so instant
await page.waitForTimeout(8000);
const back = [];
for (let i = 0; i < 5; i++) {
  const b = clockMs((await st()).clock);
  s0 = Date.now();
  await page.getByRole("button", { name: "−1s", exact: true }).click();
  await until((x) => shown(x) && Math.abs(clockMs(x.clock) - (b - 1000)) < 400, 5000);
  back.push(Date.now() - s0);
}
log(`5 × −1s inside played video: ${back.join(" ")} ms; ${check(back.every((x) => x < 400), "local rewind is fast")}`);

// 9. memory, traffic, layout
const heap = await page.evaluate(() => (performance.memory ? (performance.memory.usedJSHeapSize / 1e6).toFixed(0) : "n/a"));
log(`JS heap ${heap} MB; playlist traffic ${(plBytes / 1e3).toFixed(0)} KB; segment requests ${segRequests}`);
const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
log(`horizontal scroll: ${scroll.join(" <= ")} ${check(scroll[0] <= scroll[1], "no horizontal scroll")}`);
await page.screenshot({ path: SHOT });
log("page errors/warnings:", errors.length ? "\n   " + [...new Set(errors)].slice(0, 15).join("\n   ") : "none");
log(fails.length ? `FAILED: ${fails.join(", ")}` : "all checks passed");
await browser.close();
process.exit(fails.length ? 1 : 0);
