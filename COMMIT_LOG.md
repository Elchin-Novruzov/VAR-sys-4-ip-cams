# Commit log: Padel VAR (var-replay)

Chronological record of what changed and why, newest first. Same convention
as `padel_analytics/inout/COMMIT_LOG.md`.

---

## 2026-09-04 (night) — Replay video streams in as it downloads; a far pick no longer looks frozen

The user's report: on a 4 h recording, picking a moment about 1.5 h back
"freezes the video", and windows load slowly (live is fine). Measured before
changing anything, against yesterday's 4.4 h local recording with a
read-only MediaMTX: the recorder answers a 40 s window in under 0.1 s, so
the whole wait was the browser — one `res.blob()` per camera, 20 MB each at
4 Mbps, nothing shown until the last byte. Three things made that feel like
a freeze: the old picture stayed on screen, the "Loading…" text only ever
showed while a tile had no video at all (so never after the first window),
and the timeline stayed live during a load, so every extra press started
another 40 MB download on top of the last one.

- `lib/mp4-stream.ts` (new): cuts the fMP4 byte stream MediaMTX writes
  (ftyp+moov, then one moof+mdat per second) into an init segment and media
  segments whatever the chunking, and reads the codec string out of
  avcC/hvcC (`avc1.640020` for the test streams).
- `lib/window-loader.ts` (new): appends those segments to a Media Source
  Extensions SourceBuffer as they arrive, so the first second plays about a
  second after the request. A window can come in phases, each with its own
  `timestampOffset`. iOS 17.1+ gets `ManagedMediaSource` with the `<source>`
  child and `disableRemotePlayback` it insists on (same as hls.js). No MSE,
  or a codec MSE will not take (H.265 on Chrome): the old blob path, in one
  request. QuotaExceededError drops the already-played run-up once and
  retries. One AbortController per load.
- `components/replay-console.tsx`: a timeline pick fetches two pieces — from
  4 s before the moment to the window end first, then the run-up — so the
  picked frame shows after ~4 s of video instead of 25 s. The video `src` is
  attached by the loader, not by React. A new pick aborts the load in flight
  and a generation counter drops its late results. Each tile shows
  "loading · n / 40 s" (or MB on the blob path) until its window is in, and
  "waiting for video…" when the player runs out of data; a hole of a frame
  or two between the two pieces is stepped over on `waiting`. The ⟲ buttons
  are no longer disabled while loading. Autoplay is now a flag on the page's
  own first load; it used to linger on a 1.5 s timer after that load
  finished, so a pick made in that moment started playing by itself (caught
  by the test below).
- `CLAUDE.md`: architecture paragraph and a lesson entry updated.

Verified in headless Chrome throttled to 20 Mbps (CDP), dev server pointed
at the read-only MediaMTX over the 4.4 h recording: auto window first frame
2.2 s after opening, fully in 12 s later while playing; pick 1.5 h back →
first frame at the moment 1.8 s after the press, whole window 16 s later,
buffered ranges merge into one `[0, 40]`; playing from 19.5 s across the
seam at 21 s to 25.8 s with no `waiting` event; two picks 300 ms apart →
the first two requests `ERR_ABORTED`, the clock shows the second pick;
⟲ 30 s from a far window; `MediaSource` deleted before load → blob path,
plays at the seek target; 390 px portrait: no horizontal scroll, badges
visible; no console errors. `pnpm typecheck` and `pnpm lint` clean. Not
tested: Safari/iOS — no device here; the attach sequence is hls.js's.

Deploy: this machine has no SSH key for the VPS (password only), so the
snapshot is pushed to the public repo and the VPS step is the user's:
`cd /root/padel-var && git pull && docker compose -f infra/docker-compose.yml -f infra/docker-compose.hostproxy.yml --env-file .env up -d --build web`.

Still open on the same page: the 4 h timeline is ~18 s per pixel on a
phone, so a pick lands within ±20 s of the intended rally; a zoomed
timeline or "earlier / later window" buttons would make finding a moment
far back practical. Not asked for tonight.

## 2026-09-04 (evening) — After the club visit: relay bug fixed, docs match reality, replay page fixes

The user did the rack visit; both court cameras stream and survive a cold
reboot of the club PC with nobody logged in. His report drove everything here.

- `infra/club-relay/relay.ps1`: `"$path?user=cam"` → `"${path}?user=cam"`
  (and `${ch}`). In PowerShell `?` is a variable-name character, so the
  publish URL had no path and ffmpeg exited -5 for ever. Patched on the club
  PC on the spot; now in the repo.
- `docs/CAMERA_SETUP.md` §0 rewritten from what was found: two networks, the
  NVR static at 192.168.77.100 reached over the PC's Wi‑Fi (192.168.66.x),
  cameras as remote devices (no PoE ports in play), the channel table,
  north = ch2 / south = ch8, and what was changed on the NVR (relay user,
  admin password replaced, H.265 auto switch off, encode ch2/ch8 at H.264
  1440p25 CBR 4096, shutter 1/500 on ch2, ch8 pending). The "unplugged LAN
  port / DHCP" theory is gone.
- `infra/club-relay/README.md`: the PC steps as they actually worked — files
  fetched by raw URL, ffmpeg copied to C:\Windows so the SYSTEM task finds
  it, the scheduled task as PowerShell one-liners, powercfg, one line per
  paste, the Wi‑Fi dependency and the Ethernet-alias warning.
- `docs/CLUB_VISIT_2026-09-04.md`: an Outcome section (what the plan got
  wrong) and the next-visit list (ch8 shutter at the rack monitor, identify
  the second router and cable the PC to it with a USB adapter, speed test,
  ch3, photos, health check, replay test from the PC's Chrome, in/out photos).
- `docs/DEPLOY.md`: every compose command with both files; the overlay alone
  fails with "service web has neither an image nor a build context".
- Replay page, three findings from the visit:
  - `lib/mediamtx.ts`, `app/api/video/get/route.ts`: MediaMTX answers a
    camera that has never recorded with **400** (no recordings folder yet;
    measured against the local binary), which the site turned into 502 and
    "Recorder unreachable". 400 and 404 are now both "nothing recorded".
  - `components/replay-console.tsx`: one camera without video no longer takes
    the other down — `Promise.allSettled`, the missing tile says "nothing
    recorded yet", the master clock is the first camera that has video.
  - The ⟲ 10/30/60 s buttons and timeline picks seek inside the loaded window
    when it already covers the target instead of fetching a new one. Each
    fetch is one MP4 per camera, ~1 MB per second of window for two 4 Mbps
    streams — that was the sluggishness on a phone on cellular.
  `pnpm typecheck` and `pnpm lint` clean. **Not yet deployed**: on the VPS
  `git pull` and the `up -d --build` line in DEPLOY.md.

## 2026-09-04 — The public repo becomes a working clone (Mac at the club)

`README.md` ("Working from the public clone"), `CLAUDE.md` ("If this is the
public clone", status line). The user will clone the public snapshot on a Mac
to keep developing at the club and to ask Claude there. What a clone lacks and
how to cope: the simulator's default recordings are outside the repo
(`SIM_SOURCES`), `.env.local` is not tracked (`.env.example` is enough with the
dev login), pushing to the public repo is allowed from the clone and is merged
back into `padel-full` before the next snapshot — snapshots are force-pushed,
so the rule is "say so after pushing". Claude on the Mac has no memory of the
Windows sessions; this log is the memory.

## 2026-09-04 — Club visit checklist (`docs/CLUB_VISIT_2026-09-04.md`)

The first physical visit to the rack. Written from the two AnyDesk sessions'
findings (the NVR's LAN port is not on the club network; the court cameras
are channels D8 and D2; the NVR clock is three weeks behind): what to bring,
the NVR menus in order (cable, DHCP, NTP, new admin password + a `relay`
viewer user, channel list, encode + shutter for the two court channels), the
relay on the club PC (`find-nvr.ps1`, `relay.env`, one camera, both, the
scheduled task, a reboot test), what to record, a failure table, and five
minutes of back-wall photos for the in/out project. No passwords in the
file; the site login is referred to, not quoted.

## 2026-09-04 — Camera doc: the NVR password taken out of tracked text

`docs/CAMERA_SETUP.md` §0 quoted the NVR admin password in two places; the
club-relay README had already been scrubbed before the public snapshot, this
file had not, and the snapshot on GitHub carries it. Reworded to "the NVR
password". The snapshot's history keeps the old text, so the real fix is the
one the relay README already asks for: give the NVR's `admin` a new strong
password at the rack and create a viewer account for the relay.

 deployed on the shared VPS behind the host Caddy, camera path proved

The site is up at https://72-62-236-90.sslip.io with a real certificate.
On the VPS (72.62.236.90): `/root/padel-var` is a clone of the public
snapshot repo; `.env` holds DOMAIN, a generated PUBLISH_PASS, the same Mongo
server with database `var-replay`, a generated AUTH_SECRET and AUTH_URL.
Only `mediamtx` (1935/tcp, 8890/udp) and `web` (127.0.0.1:3000) run, via
the hostproxy override; the host Caddy got the site block and its global
`auto_https off` became `disable_redirects` (Caddy validated, reloaded, cert
issued within seconds). The image built in 135 s on the box.

Verified from the office PC, not by inspection: `/api/health` reports every
variable present; a scripted login returns 302; `pnpm sim` pointed at the
server pushed both fake cameras (10–35 % CPU here) and
`/api/video/segments` then listed a growing recording for court1-north and
court1-south. That is the exact path the club relay will use. The admin login
was created with `pnpm seed-user` from the office (upsert by email).

Two things learned on this box: Docker and Compose v5 were already installed
from Docker's repo, so `apt install docker-compose-v2` collides
(`dpkg --configure -a` completes the half-done upgrade and restarts every
container for ~10–30 s); and the Mongo container is published on the public
IP with a weak password — flagged to the user, not changed.

Next: the club session — `PUBLISH_PASS` from `/root/padel-var/.env` and
`SERVER=72-62-236-90.sslip.io` into `relay.env` on the club PC.

---

## 2026-09-03 — Deploying on the shared VPS: host-Caddy variant, public snapshot repo, LAN scanner

The user's VPS (72.62.236.90, Ubuntu 25.10, 8 GB) already runs five
containers (two Mongos, two APIs, MSSQL) and a host Caddy on :80 serving
HTTP-only sites with `auto_https off`; port 443 is free. Rather than fight
the bundled caddy service for 80/443, `infra/docker-compose.hostproxy.yml`
starts only `mediamtx` and `web` (site on 127.0.0.1:3000) and the host Caddy
gets one HTTPS site block; `docs/DEPLOY.md` documents it, including why the
global option must become `auto_https disable_redirects` (off also disables
certificates) and the `sslip.io` name used until a real domain exists
(`72-62-236-90.sslip.io`).

`padel-full` is private and the user did not want a token on the server, so
they created a public repo, `Elchin-Novruzov/VAR-sys-4-ip-cams`, and asked
for the var-replay folder to be pushed there — the one authorised exception
to never-push. It holds a fresh single-commit snapshot from
`git archive HEAD:var-replay` (71 files), secret-scanned first; the scan
caught the club-relay README quoting the real NVR password as its "weak
password" example, now a generic one.

Also: `infra/club-relay/find-nvr.ps1` scans the club LAN for devices on
554/80/37777 (the club PC is on 192.168.88.0/24, wired), because the
one-liner given by chat kept getting mistyped over AnyDesk and no paste
route worked. Clipboard sync across AnyDesk failed on the club side; rentry
and dpaste both failed for one reason or another; the working transfer is
still pending.

---

## 2026-09-03 — The club's answers decide the camera path: relay on the club PC

Relayed from the club: **no static IP**, the cameras are **Dahua** behind a
Dahua NVR, the NVR admin password (kept out of git), and an offer of
**AnyDesk** access to a PC on the club LAN.

What that decides, now written at the top of `docs/CAMERA_SETUP.md` as §0:
no static IP kills the server-pulls-from-NVR variant (§2d) — nothing inbound
reaches the club, so the stream must leave outbound. Of the two outbound
options, the relay (§2c) is the plan: it needs only the NVR's address and
password, which we have, changes nothing on the cameras or NVR, and does not
depend on each camera's firmware having an RTMP menu (§2a stays the fallback).

`infra/club-relay/` is that relay packaged for the Windows PC the club can
give access to: `relay.ps1` (PowerShell 5.1, one ffmpeg per camera pulling
`rtsp://NVR/cam/realmonitor?channel=N&subtype=0` and pushing
`rtmp://SERVER:1935/<path>?user=cam&pass=…`, restarted for ever, logs per
camera), `relay.env.example` (NVR + server credentials and the
path:channel map), and a README that is the step-by-step for the AnyDesk
session — ffmpeg via winget, one camera first, then the scheduled task, then
the encoding settings and the facts to record. `relay.env` and `logs/` are
gitignored; the NVR password lives nowhere else. The script parses clean
under PowerShell 5.1; it has not run against a real NVR yet.

The blocker is unchanged and stated in both places: the media server needs a
VPS with a domain and port 1935 open (`docs/DEPLOY.md`) — Vercel hosts only
the site — and the internet path should be proved with `pnpm sim` before the
club session. I cannot drive AnyDesk; the README is written so the user can.

---

## 2026-09-03 — /api/health: a deployment doctor that answers while auth is down

The user deployed to Vercel (padel-full.vercel.app, GitHub repo
Elchin-Novruzov/padel-full, root directory var-replay). Every route returned
a bare 500 — the signature of the auth middleware throwing MissingSecret on
each request because AUTH_SECRET never reached the production runtime; the
build doesn't need the secret, so the build was green. Still 500 after their
first env attempt, so instead of guessing at their dashboard:

`GET /api/health` reports presence (booleans, never values; AUTH_URL as
plain text since it is the public address) of AUTH_SECRET, MONGODB_URI and
the MEDIAMTX_* vars, plus the Node version. It is excluded from the
proxy.ts matcher, so it answers even when a broken auth config kills every
other route — that is the whole point. Verified against the local dev
server: reports all vars present.

Vercel env checklist that goes with it: vars scoped to Production, exact
names, redeploy after saving, and a seeded real user (dev@local is disabled
in production builds).

---

## 2026-09-03 — Camera doc gains the pull variant; rack photos identified

The user sent photos of the club rack: a Dahua NVR and a separate Hikvision
PoE switch that all camera cables land on — so the cameras most likely have
their own IPs on the club LAN (good for every option; camera brand still
unconfirmed, the NVR camera list shows model per channel). They asked whether
it would be easier to get the NVR's credentials and have the server fetch the
video instead of configuring push.

Answer captured in `docs/CAMERA_SETUP.md` as new section 2d: MediaMTX can
pull per path (`source: rtsp://...` on the court paths instead of
`source: publisher`), everything downstream unchanged. Requirements and
risks spelled out: static public IP with no CGNAT, a router port forward to
the NVR, a viewer account, and a source-IP firewall restriction to the VAR
server only. Push stays plan A because it needs none of that; pull is the
documented plan B, arguably less work for the installer when the ISP
cooperates.

---

## 2026-09-03 — CLAUDE.md files: the workspace explains itself to a new agent

The user asked for markdown that lets a fresh AI session know what is going
on. Two files, written to complement (not repeat) README/PLAN/COMMIT_LOG:

- **`../CLAUDE.md`** (repo root): the workspace map — var-replay is the
  active project, padel_analytics/inout is the paused in/out CV system with
  its own log and handoff — plus the standing conventions (commit every
  turn, never push, per-project COMMIT_LOG entries, unsure-grades rule,
  keep the August renders).
- **`CLAUDE.md`** (this folder): commands and the dev login, the
  architecture invariants that span files (courts.json ↔ mediamtx.yml,
  proxy.ts PUBLIC_PREFIXES, AutoReload/version, touch sizing in
  globals.css), the paid-for lessons (no function props across the
  server/client boundary, hand-rolled fmtDateTime, anchored media
  gitignore rules, single next dev per folder, .env restart), and the
  browser-driven verification workflow with the curl login.

---

## 2026-09-03 — Stale pages fix themselves: AutoReload on a new build

The user had to clear site data ("cookies") to see changes. Root cause is not
HTTP caching — HTML already goes out `no-cache`, hashed assets are immutable,
and there is no service worker. It is the long-lived page: a courtside phone
or home-screen tablet keeps one tab open for days, background/bfcache restores
never refetch, and the installed web app has no reload button. Clearing
cookies only "worked" because logging out forced a fresh navigation.

**`GET /api/version`** (public, `no-store`) returns the deployed `BUILD_ID`
(read from `.next/BUILD_ID` at runtime; in dev, a boot timestamp — an old
build's BUILD_ID on disk is deliberately ignored there). **`AutoReload`** in
the root layout fetches it on mount, then again whenever the app returns to
the foreground (`visibilitychange`, `pageshow` with `persisted`) and every
5 minutes while visible; a changed id reloads the page, unless a video is
actually playing — then it waits for the next trigger rather than yanking a
replay out from under the referee.

Verified in headless Chrome against the dev server with a mocked version
route: mount stores the id, flipping the mock and firing `visibilitychange`
reloads the page, an unchanged id does not. Endpoint answers 200 logged out.

---

## 2026-09-03 — Whole site walked at phone/tablet sizes; clip and share pages fixed

Asked to make the site responsive for phones and tablets. The console, live
grid and header already were (the two commits below); what remained was to
verify every page, not just the console — and that walk found the clip and
share pages had never rendered at all.

**Bug 1: `/clips/[id]` and `/share/[token]` returned 500.** Both server pages
passed `fileUrl={(camera) => ...}` into the client component `ClipPlayers`;
Next.js forbids function props across the server/client boundary, so the
render threw. Nobody had opened a saved clip before (the DB had none; the one
folder on disk was orphaned). `ClipPlayers` now takes a `fileBase` string and
builds the query itself.

**Bug 3, found while committing: the clips feature was never in git.** The
`.gitignore` line `clips/` (unanchored, and duplicated) matched not only the
saved-media folder but also `app/(dashboard)/clips/` and `app/api/clips/` —
the clips pages and the whole save/list/file/share API existed only on disk.
The media rules are now anchored (`/clips/`, `/recordings/`, `/.mediamtx/`)
and the missing source is committed.

**Bug 2: hydration mismatch on the clip header.** `fmtDateTime` used
`toLocaleString`, and Node and Chrome resolve the default locale differently.
Now a hand-rolled `YYYY-MM-DD HH:mm:ss`, plus `suppressHydrationWarning` on
that line for when the VPS's timezone differs from the viewer's.

**Verification, all of it driven in headless Chrome** (playwright-core +
installed Chrome, dev login via the curl flow, sim recorder running):
login, courts, replay console, live, clips list, clip page and share page at
390×844, 360×740, 844×390, 820×1180 and 1180×820 — zero horizontal overflow
and no page errors anywhere. Interactions, on the phone viewport: ⟲ 10s
loaded real video into both cameras, Play ran, Save cut a clip through the
UI prompt ("Responsive check", left in the DB), the clip and share pages play
it at every size, and both live HLS tiles reached `currentTime > 0`.

---

## 2026-09-03 — Replay page shows video on open

The user opened Replay and got two black tiles saying "Press ⟲ or drag the
timeline"; the picture only appeared after pressing a replay-last button.
Now, as soon as the recorder reports something to show, the page loads the
last 30 seconds by itself and plays them (muted video autoplays). Any later
load, from the buttons or the timeline, starts paused as before. The empty
state reads "Loading the latest video…", or "Waiting for the cameras…" when
the recorder has nothing yet.

---

## 2026-09-03 — Phone sizing tightened, and the layout rendered for real

The user's DevTools screenshot at 390 px showed everything about 1.7× too
big and cut off on the right. Measured against CSS sizes, the layout viewport
was still 390 px (three equal switch buttons of 122 px each) and the frame
showed a magnified 234 px slice: the emulated page was pinch-zoomed, which
Chrome device mode does on Ctrl + wheel and keeps across reloads.

Real bug fixed on the way: the top strip did not wrap at 390 px (pill plus
three buttons need about 470 px), and the court name, the only shrinkable
item, collapsed to nothing. The camera switch now wraps to its own full-width
row under 640 px with equal buttons; the name gets min-w-0 and flex-1.

Compact phone sizing: header 48 px and 40 px controls under 640 px, 32 px
switch buttons, tighter bottom-bar spacing, cameras at least 42dvh. On an
844 px screen the whole console fits without scrolling.

Verification, finally with a browser: Playwright's CLI driving the installed
Chrome (`pnpm dlx playwright screenshot --browser chromium --channel chrome
--device "Pixel 7" --load-storage state.json`, with a session cookie taken
from a curl login). Apple presets default to WebKit and refuse the Chrome
channel, so Pixel 7 portrait, Pixel 7 landscape, Galaxy Tab S4 and a
1280×800 desktop were rendered instead: all four fit, none overflow.

---

## 2026-09-03 — Login: show-password toggle, 30-day option verified, env read lazily

**Show password.** `components/password-field.tsx`, a small client component
inside the otherwise server-rendered login form; plain `name="password"` so
the server action is unchanged.

**"Keep me signed in for 30 days" checked against a production build**, with
the real admin account from Mongo, by decoding the issued session token:
ticked = JWT lifetime 720 h, unticked = 8 h (the cookie itself is always
30 days; the token inside expires first). Wrong password and the dev login
under NODE_ENV=production both leave no cookie. The mechanism is the one the
labeling site uses: `jwt.encode` picks maxAge from the token's `remember`.

**Bug fixed on the way.** `lib/mongodb.ts` captured `MONGODB_URI` at module
load. Next 16 hot-reloads `.env.local` without a restart, so a server started
before the variable existed kept reporting "MONGODB_URI is not set" for every
real login even after the file changed (the dev login still worked, which is
why it looked like an account problem). The URI is now read at connect time.
A running dev server still needs one restart to pick up the new file.

Also learned: Next 16 refuses a second `next dev` in the same folder, so
tests against a production build ran from `.next/standalone` on port 3001
alongside the user's dev server; and curl stores HttpOnly cookies with a
`#HttpOnly_` prefix in its jar, which the first version of the check skipped.

---

## 2026-09-03 — Responsive: phones and tablets are the replay device

The user confirmed the local run works and asked for tablet and phone layouts,
since that is where users will replay from.

**Replay console fills the screen, no page scroll.** The page is a flex
column of exactly `100dvh - var(--app-header)`: top strip, cameras, bottom
bar. Cameras stack in portrait and sit side by side in landscape (Tailwind
`portrait:`/`landscape:` variants, so an iPad held upright also stacks, which
gives each picture more height than side by side would). A "Both / North /
South" switch lets a phone show one camera large; the hidden video stays
mounted so the clock and the loaded blob survive the switch.

**Every control is in a bottom bar within thumb reach**, with safe-area
padding: replay-last buttons, transport, speeds, time, timeline toggle, Save.
They wrap by group on narrow screens. The position slider has a 28 px thumb.
The keyboard hint only shows from `md` up.

**Short landscape phones:** a media query (`max-height: 520px` and landscape)
sets the header height to 0, hides it, and hides the scrub area by default;
the ⌁ button brings the timeline back. Nothing else changes.

**Touch semantics in ZoomPan:** `touch-action: pan-y` while unzoomed (a swipe
scrolls the page, two fingers pinch), `none` once zoomed (a finger pans the
picture). Real double-tap detection on touch pointers, since `dblclick` is
unreliable there; mouse double-click still works. Buttons get
`touch-action: manipulation` (no tap delay), videos block the long-press
callout, the body has `overscroll-behavior: none`.

**Installable.** `app/manifest.ts` (public in proxy.ts), Apple web-app meta,
theme colour, and 192/512 px icons generated with ffmpeg, so a courtside
tablet can run it full screen from the home screen. `pnpm dev:lan` binds the
dev server to the LAN for testing on a phone.

Live grid gets the same fill-the-screen layout; clip pages use the
orientation grid. Not verified on a real device from here (no browser); the
layout logic is CSS and was checked by build only.

---

## 2026-09-02 — Padel VAR scaffolded: cloud replay on the club's own cameras

New folder `var-replay/`, a separate Next.js 16 + TypeScript + MongoDB site,
same stack and login pattern as the labeling site.

**Why this exists.** The in/out CV system missed its deadlines. A replay tool
on the club's existing security cameras is a real product on its own, needs no
hardware, and buys time. The user's constraints: nothing at the club may talk
to their PC, the cameras must be reachable over the internet from anywhere,
and the cameras themselves should push (no relay box). Retention four hours.

**Architecture built.** MediaMTX on a VPS receives RTMP from the cameras,
records fMP4 in one-second parts and fifteen-second segments, deletes after
four hours, and answers time-range requests (`/list`, `/get`). Next.js is the
only thing that talks to it: every video request goes through a route handler
that checks the session and that the camera path is in `config/courts.json`.
Caddy terminates HTTPS. MongoDB Atlas holds users and saved clips.

**What the site does.** Login; courts page with a streaming indicator per
camera from the control API; live tiles over proxied HLS; the replay console
(both cameras on one clock, "replay last 10/30/60 s", timeline of the buffer,
scrub, play/pause, speeds 1× to 0.1×, frame step, keyboard shortcuts, pinch
and wheel zoom with pan); "save this moment" cuts 16 s from every camera into
a kept MP4 and a share link; clips list, clip page, public share page with
Range-capable file serving.

**Simulator.** `pnpm sim` loops two part4 court recordings into the media
server as fake cameras, re-encoded like a security camera (H.264, 25 fps,
4 Mbps CBR, 1 s GOP) with the wall clock burned in, so time alignment can be
checked by eye. `pnpm mediamtx` downloads and runs the server locally with the
same config Docker uses.

**Not in this commit.** WebRTC live (HLS only, a few seconds behind), player
accounts, multi-court branding. Camera brand still unknown, so
`docs/CAMERA_SETUP.md` covers Dahua RTMP push, Hikvision, and an ffmpeg relay.
