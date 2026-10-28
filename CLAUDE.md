# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Court replay for a padel club on its existing security cameras: both ends of
the court on one clock, rewind, scrub, slow motion, frame step, pinch zoom,
"save this moment" with a public share link. Phones and tablets are the
primary devices — every change must hold up at phone and tablet sizes.

Start with [HANDOVER.md](HANDOVER.md): current state, how everything works,
operations, troubleshooting and open items in one place.

Where the story lives: [PLAN.md](PLAN.md) (product decisions, architecture,
phases), [README.md](README.md) (local run), [COMMIT_LOG.md](COMMIT_LOG.md)
(newest-first history of what changed and why — **read the top few entries
first**, and add an entry with every commit), [docs/DEPLOY.md](docs/DEPLOY.md)
and [docs/CAMERA_SETUP.md](docs/CAMERA_SETUP.md) (the path to production).

Status 2026-10-25: **live at https://72-62-236-90.sslip.io** on the shared
VPS (`docs/DEPLOY.md`, "Existing reverse proxy on the host"); both court
cameras relayed from the club PC since 2026-09-04; replay rebuilt on
2026-10-21 (one HLS timeline over the recording files) and deployed. Still
to confirm with the real cameras — HANDOVER.md §1 and §10.

## If this is the public clone

This folder may be the public snapshot
(github.com/Elchin-Novruzov/VAR-sys-4-ip-cams, snapshot commits exported
from the private `padel-full` workspace) cloned on the user's Mac. Same
conventions apply — commit every turn, add a `COMMIT_LOG.md` entry — with two
differences: **pushing to origin is allowed here** (the user owns the repo and
merges it back into `padel-full`; never rewrite its history), and the in/out
project's recordings that `scripts/sim.ts` defaults to are not in this repo
(`SIM_SOURCES` points the simulator at any two videos, see README). There is
no memory of earlier sessions on this machine; the log is the memory.

## Commands

Local dev needs three terminals (Node 22+, pnpm, ffmpeg on PATH):

```bash
pnpm mediamtx     # media server (downloads binary once)
pnpm sim          # two court recordings loop in as fake cameras
pnpm dev          # the site on :3000   (dev:lan binds 0.0.0.0 for phone testing)
```

Dev login `dev@local` / `dev` (from `.env.local`; ignored in production
builds). Real logins: `pnpm seed-user email name password admin`.

`pnpm typecheck` and `pnpm lint` before committing. There is no test suite:
verification is driving the real app in a browser (see below).

## Architecture in one breath

MediaMTX receives RTMP from the cameras and records a rolling fMP4 buffer
(1 s parts, 15 s files that start on a keyframe, deleted after 4 h).
**Next.js is the only thing the browser talks to**: every video byte goes
through a route handler that checks the session and that the camera path
exists in `config/courts.json`. Replay (since 2026-10-21) is **one HLS
timeline per camera over the whole buffer**: `lib/recordings.ts` indexes
the recording files (moof boxes only), cuts them into ~2 s keyframe-aligned
segments and serves a live playlist with delta updates
(`/api/replay/<camera>/index.m3u8`), init sections and remuxed segments;
`lib/replay-player.ts` plays it with hls.js (the browser's own HLS on an
old iPhone) and maps video time to wall clock; `components/replay-console.tsx`
keeps the second camera on the first one's clock and
`components/scrubber.tsx` is the bar (All / 30m / 5m / 1m zoom). Live view
still proxies MediaMTX's own HLS. Saving a clip cuts MP4s through MediaMTX's
`/get` to `clips/<id>/` on disk plus a Mongo doc with a share token.

Invariants that span files:

- Camera paths in `config/courts.json` must match `paths:` in
  `infra/mediamtx.yml`; `retentionHours` must match `recordDeleteAfter`.
  That includes the in/out detector cameras (`court1-det-<name>`,
  `group: "detector"`, pushed by padel_analytics `live_multi.py --var`).
- Every recorded time is on the **court clock** = the camera's own times +
  its offset (`lib/offsets.ts`): `/api/replay/state` shifts the spans,
  `CameraPlayer.offsetMs` shifts the playlist times, `lib/clips.ts` cuts at
  `start − offset`. Anything new that reads recording times must apply it too.
- The site reads MediaMTX's recordings: `RECORDINGS_DIR` is the root of
  `recordPath` (local `./recordings`; Docker: the `recordings` volume
  mounted read-only into `web` at `/recordings`). `/api/health` shows the
  files it sees per camera — `null` means the mount is missing.
  `recordFormat: fmp4` is required (the index reads moof/trun and mtxi).
- `proxy.ts` is the auth middleware; anything reachable logged-out must be in
  its `PUBLIC_PREFIXES` (login, share pages, shared-clip files,
  `/api/version`, manifest).
- `/api/version` + `AutoReload` (root layout) make long-lived courtside pages
  reload themselves on a new build. Keep the version route public and
  `no-store`.
- Touch sizing lives in `app/globals.css` (44 px controls, 40 px under
  640 px); short-landscape phones hide the header (`.app-header`) and keep
  the replay controls on one line (`.controls-row`). New controls inherit
  this — don't hardcode heights.
- The look is **Padel Center Baku**'s brand (since 2026-10-28): colours are
  the tokens in `globals.css` `:root` (no new hex values in components),
  headings `.display` (Bebas Neue), buttons `.btn-accent` / `.btn-brand` /
  `.seg` with `aria-pressed`. Those classes are unlayered, so Tailwind
  utilities need `!` to override them. `motion` animations stay on the
  brand pages, never in the replay console. HANDOVER §9 "Look and brand".
- `scripts/checks/replay-audit.mjs` finds the clock by `[data-clock]` and
  buttons by accessible name (`Play`/`Pause`, `back one frame`, `10s`,
  `−10`, `1×`): keep those names when restyling the console.

## Lessons already paid for (don't rediscover)

- Server pages must not pass **functions** to client components — the clip
  and share pages 500'd for a day this way. Pass strings (`fileBase`).
- `fmtDateTime` in `lib/time.ts` is hand-rolled because Node and Chrome
  resolve the default locale differently → hydration mismatch. Don't switch
  it back to `toLocaleString`.
- The media `.gitignore` rules must stay **anchored** (`/clips/`,
  `/recordings/`, `/.mediamtx/`). A bare `clips/` once silently kept
  `app/(dashboard)/clips/` and `app/api/clips/` out of git entirely.
- Next 16 refuses a second `next dev` in the same folder. To test a
  production build alongside the user's dev server: `pnpm build`, then run
  `.next/standalone` on port 3001.
- `.env.local` edits hot-reload, but a server started **before** a variable
  existed needs one restart (Mongo URI is read lazily for this reason).
- Cameras record ~25 fps: the product is replay for disputes (double bounce,
  glass-first), **never** automatic line calling. Keep that framing in any
  user-facing text.
- Replay used to fetch 40 s windows (blob, then MSE): rolling back past a
  window's start was a new 20 MB-per-camera download, 16 s of blank picture
  on a phone on 4G (measured 2026-10-21). Don't go back to windows; the HLS
  timeline loads the ~2 s around the target, ~1 MB per camera.
- hls.js `progressive: true` with a live playlist corrupts its timeline:
  a reload copies a half-parsed segment's duration (one frame) into the new
  playlist. Keep it off; segments are one moof+mdat.
- hls.js only drops a running download when you seek *forward* past it;
  rolling back waited for the old segment first. `CameraPlayer.seek` stops
  and restarts loading for a target that is not downloaded.
- Two cameras on one line: after a jump the second camera waits
  (`held`, loading stopped) until the first shows its frame, then aligns;
  a follower that falls behind seeks ahead without aborting its own
  download, at most every 1.5 s — aborting made it chase for ever on 10 Mbps.
  Resume = seek first, then startLoad, or hls.js fetches the old position.
- `play()` on an *ended* video restarts it from the oldest moment (HTML
  spec). The console stops at the end of a camera that stopped streaming.
- Before hls.js reaches its start position the element sits at time 0 —
  the oldest moment of the buffer. `CameraPlayer.wallNow()` stays null
  until it is positioned (a camera created then opened 4 h back).
- A playlist that never changes makes hls.js reload it in full every
  second. A camera that stopped streaming gets `#EXT-X-ENDLIST` (after 10 s
  without writes, never between two files); the page restarts its player
  when the camera records again.
- `lib/recordings.ts` keeps its index on `globalThis` (the dev server
  gives each route its own module copy): **restart the dev server after
  editing it**, a hot reload keeps the old instance.
- A deploy that changes `infra/mediamtx.yml` needs `up -d --force-recreate
  mediamtx` on the server: the config is a single-file bind mount into a
  prebuilt image, `up -d --build` leaves the old container (and the old
  file's inode) running. The detector paths were refused as unknown after a
  normal deploy on 2026-10-26.
- Never run `pnpm mediamtx` (recordDeleteAfter 4h) on a folder holding
  test recordings: it deletes them. Live tests record into a scratch
  recordPath with their own MediaMTX config; read-only tests use a config
  with `record: no`.

## Verifying in a real browser (no test framework)

The established workflow (see COMMIT_LOG entries from 2026-09-03):

1. Get a session cookie by scripting the login: GET `/api/auth/csrf`, then
   POST `/api/auth/callback/credentials` with the csrf token and the dev
   login; store cookies as a Playwright storage-state JSON.
2. Drive the installed Chrome headlessly with `playwright-core` and
   `chromium.launch({ channel: "chrome" })` (no browser download), or
   `pnpm dlx playwright screenshot --browser chromium --channel chrome`.
3. With `pnpm sim` running there is real video: wait for
   `video.videoWidth > 0`, not just selectors.
4. Responsive checks: assert
   `document.documentElement.scrollWidth <= clientWidth` at 390×844, 844×390,
   820×1180, 1180×820 and screenshot each; look at the screenshots.
5. Replay timing: `scripts/checks/replay-audit.mjs` does all of this and
   prints OK/FAIL per step (`scripts/checks/README.md`). By hand: throttle
   with CDP `Network.emulateNetworkConditions`
   (a phone on 4G: 10 Mbps, 60 ms) and read the players through
   `window.__replay` (development builds, or `?debug` on any build):
   `wallNow()`, `frameTime` (the frame on screen), `buffered()`. A
   production build has no dev login: sign a session cookie with
   `next-auth/jwt` `encode` and the local `AUTH_SECRET` (salt
   `authjs.session-token`) instead of creating a user in the shared Mongo.

## Conventions

Commit every turn, never push. Every commit gets a newest-first entry in
[COMMIT_LOG.md](COMMIT_LOG.md) saying what changed, why, and how it was
verified.
