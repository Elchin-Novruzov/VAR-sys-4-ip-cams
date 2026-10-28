// Live sync on the live page: how far apart the tiles' pictures are, before
// and after knocking one tile back by 1 s and by 3.5 s. Needs a MediaMTX with
// two cameras streaming. Run from a folder with playwright-core installed
// (scripts/checks/README.md).
import { createRequire } from "module";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright-core");

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? ".";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "dev@local");
  await page.fill('input[name="password"]', "dev");
  await Promise.all([page.waitForURL(/\/courts/), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/courts/court1/live`);
  await page.waitForFunction(() => [...document.querySelectorAll("video")].filter((v) => !v.paused && v.readyState >= 3).length >= 2, null, { timeout: 40000 });

  const read = () =>
    page.evaluate(() => {
      const live = window.__live ?? {};
      const at = Object.entries(live).map(([k, c]) => [k, c.frameDate(), c.video.playbackRate]);
      const ds = at.map((x) => x[1]).filter((x) => x !== null);
      const pill = [...document.querySelectorAll(".pill")].map((p) => p.textContent).find((t) => /sync/i.test(t ?? "")) ?? "(none)";
      return { spread: ds.length > 1 ? Math.round(Math.max(...ds) - Math.min(...ds)) : null, rates: at.map((x) => x[2].toFixed(2)).join("/"), pill };
    });
  const watch = async (label, secs) => {
    const out = [];
    for (let i = 0; i < secs * 2; i++) {
      await page.waitForTimeout(500);
      const r = await read();
      out.push(`${r.spread}ms(${r.rates})`);
      if (i === secs * 2 - 1) console.log(`${label}: end spread ${r.spread} ms, pill "${r.pill}"`);
    }
    console.log(`  trace: ${out.filter((_, i) => i % 2 === 0).join(" ")}`);
  };

  await watch("settle 8 s", 8);
  await page.screenshot({ path: `${OUT}/live_sync.png` });
  await page.evaluate(() => {
    const v = Object.values(window.__live)[0].video;
    v.currentTime -= 1;
  });
  await watch("after one tile 1 s back", 10);
  await page.evaluate(() => {
    const v = Object.values(window.__live)[0].video;
    v.currentTime -= 3.5;
  });
  await watch("after one tile 3.5 s back", 8);
} finally {
  await browser.close();
}
