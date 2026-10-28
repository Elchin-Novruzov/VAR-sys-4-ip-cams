// Drives the VAR review features on the replay page and reports what the
// clock did. The save is intercepted in the browser (no clip is cut, nothing
// reaches the shared Mongo). Run from a folder with playwright-core
// installed (scripts/checks/README.md).
import { createRequire } from "module";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright-core");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? ".";
const [W, H] = (process.env.VIEW ?? "1180x820").split("x").map(Number);

const clockMs = (s) => {
  const m = /(\d+):(\d+):(\d+)\.(\d+)/.exec(s ?? "");
  return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] * 10 : null;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W < 1000 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "dev@local");
  await page.fill('input[name="password"]', "dev");
  await Promise.all([page.waitForURL(/\/courts/), page.click('button[type="submit"]')]);

  await page.route("**/api/clips", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}");
    console.log("save request:", JSON.stringify(body));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        clip: { id: "000000000000000000000000", courtSlug: "court1", label: body.label, start: body.start, durationSec: body.durationSec, cameras: [], createdBy: "test", createdAt: new Date().toISOString(), shareToken: "testtoken123" },
      }),
    });
  });

  const t0 = Date.now();
  await page.goto(`${BASE}/courts/court1?back=20`);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/rv_open_${W}.png` });
  await page.waitForFunction(() => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0 && !v.paused), null, { timeout: 30000 });
  const clock = async () => clockMs(await page.locator("[data-clock]").textContent());
  const behind = await page.locator("span.pill.tabular-nums").first().textContent();
  console.log(`open ?back=20: playing after ${Date.now() - t0} ms; readout "${behind}"`);

  await page.waitForTimeout(1500);
  await page.keyboard.press("m");
  const mark = await clock();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/rv_mark_${W}.png` });
  console.log("marked at", mark, "strip:", (await page.locator(".controls-row").first().textContent())?.slice(0, 60));

  // rock: sample the clock for 9 s
  await page.keyboard.press("r");
  const samples = [];
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(150);
    samples.push(await clock());
    if (i === 20) await page.screenshot({ path: `${OUT}/rv_rock_${W}.png` });
  }
  const rel = samples.filter((x) => x !== null).map((x) => x - mark);
  let turns = 0;
  for (let i = 2; i < rel.length; i++) if (Math.sign(rel[i] - rel[i - 1]) !== Math.sign(rel[i - 1] - rel[i - 2]) && rel[i] !== rel[i - 1]) turns++;
  console.log(`rock: min ${Math.min(...rel)} ms, max ${Math.max(...rel)} ms around the mark, direction changes ${turns}`);
  console.log("rock trace (ms from mark):", rel.filter((_, i) => i % 3 === 0).join(" "));
  const badge = await page.locator(".tile-badge").first().textContent();
  console.log("badge:", badge);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  console.log("after Escape, badge:", await page.locator(".tile-badge").first().textContent());

  // loop
  await page.keyboard.press("o");
  const loop = [];
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(150);
    loop.push(await clock());
  }
  const lrel = loop.filter((x) => x !== null).map((x) => x - mark);
  let wraps = 0;
  for (let i = 1; i < lrel.length; i++) if (lrel[i] < lrel[i - 1] - 1500) wraps++;
  console.log(`loop: min ${Math.min(...lrel)} max ${Math.max(...lrel)}, wraps ${wraps}`);
  await page.keyboard.press("o"); // stop

  // save sheet
  await page.keyboard.press("s");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/rv_sheet_${W}.png` });
  await page.getByRole("button", { name: "Double bounce" }).click();
  await page.getByRole("button", { name: "Save moment" }).click();
  await page.waitForSelector(".toast", { timeout: 5000 });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/rv_saved_${W}.png` });
  console.log("toast:", (await page.locator(".toast").textContent())?.replace(/\s+/g, " "));

  await page.locator(".toast button[aria-label=close]").click();
  const m = await page.evaluate(() => {
    const c = document.querySelector(".console");
    const row = [...document.querySelectorAll(".controls-row")].pop().getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, inner: c.scrollHeight - c.clientHeight, rowBottom: Math.round(row.bottom), vh: innerHeight };
  });
  console.log(`layout ${W}x${H}: overflowX=${m.sw > m.cw} scrollY=${m.sh > m.ch} console overflow ${m.inner}px, last controls row ends at ${m.rowBottom}/${m.vh}; page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  await page.screenshot({ path: `${OUT}/rv_final_${W}.png` });
} finally {
  await browser.close();
}
