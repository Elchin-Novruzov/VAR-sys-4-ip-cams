# Commit log: Padel VAR (var-replay)

Chronological record of what changed and why, newest first. Same convention
as `padel_analytics/inout/COMMIT_LOG.md`.

---

## 2026-10-28 — Phones and iPads: 18 device profiles, every page fits; Replay and Live in the header

The owner: make it phone friendly and iPad friendly; and add pages for live
and replay (read as: Replay and Live in the navigation, next to Courts and
Clips).

**Measured first.** `scripts/checks/responsive-audit.mjs` (new) loads every
page on Playwright's device profiles -- iPhone SE (320×568), SE 3rd gen,
iPhone 13 (390×664: the real visible area with Safari's bars, much shorter
than the 844 used before), 15 Pro Max, Galaxy S8, Pixel 7, all four on
their side, iPad mini / Air / Pro 11 / Pro 12.9 both ways -- with touch
and mobile emulation, and flags sideways scroll, content cut off by its own
box, the replay console taller than the screen, the save sheet off screen,
tap targets under 32 px. First run: 15 of 180 checks failed, all phones:

- under ~390 px the replay button groups were wider than the screen and the
  whole console slid sideways (a tap on Mark scrolled it);
- on a phone on its side the incident strip pushed the buttons 5–38 px
  below the screen and the save sheet ran 59–97 px off it;
- on the 320 px phone the courts card's instant-replay row was cut off.

**Fixes** (`globals.css` unless said):

- Header: four tabs **Courts / Replay / Live / Clips** (`NavLinks`, the lime
  pill slides between them); icons on a phone with the open one named,
  names from 768 px. With one court Replay and Live open it directly. The
  VAR tag shows from 400 px, the e-mail from 1280 px; logo and sign-out are
  40 px targets.
- Narrow phones: under 400 px the replay buttons lose padding; under 360 px
  ±1 s and the timeline toggle hide (frame steps and ±10 stay). The console
  is `overflow-x: hidden`.
- Phone on its side (`short:`): 36 px controls, the four speeds become one
  button that cycles, ±1 s and the timeline toggle hide, a 36 px bar, the
  pictures may go down to 30dvh, the save sheet goes two columns.
- `--tiles-min` replaces the inline picture floor (26dvh on short upright
  phones).
- Save sheet: never taller than the screen (`max-height`, scrolls inside).
- iPhone safe areas: `--chrome-top` (header + `env(safe-area-inset-top)`)
  for the home-screen app's status bar, body side padding for the notch.
- iPad: keyboard hints and the shortcut card only with a mouse or trackpad
  present (`desk:` = `any-pointer: fine`).
- Incident-strip buttons 36 px; courts card's instant-replay row wraps.
- Live tiles: a camera that is not streaming said
  "networkError: manifestLoadError" and stayed dead until a reload. Now
  "This camera is not streaming right now", retried every 5 s; a camera
  started later played in 13.5 s without a reload (scratch MediaMTX, its
  record path in a temp folder; the test footage untouched).

**Verified**: final audit 180 checks, 0 problems (left as notes: the
remember-me checkbox, whose whole label row is the target, and the 28 px
zoom chips on a phone on its side). Phone replay audit: all passed, same
numbers. Review check at 390×844: rock, loop, save as before. Typecheck,
lint, `pnpm build` clean. `review-check.mjs` and `live-sync-check.mjs`
(the earlier scratch tests) are now in `scripts/checks/` with a README
section on running live tests safely.

## 2026-10-28 — VAR review (mark, rock, loop), "save the moment", live sync, the control room

The owner, after the rebrand: more moving parts and new sections on the main
page, and replay functions that feel like an official (football) VAR --
back-and-forth replay, easy replay, save the moment -- with the live cameras
in sync.

**Replay console** (`components/replay-console.tsx`, CSS only, no motion
library):

- **Incidents**: Mark (M) flags the moment on screen; flags on the bar
  (`Scrubber` `marks` / `activeMark`), a strip with ‹ n/m › ([ ]), Loop,
  Rock and remove. Session-only.
- **VAR review**: Rock (R) plays the incident from 2 s before to 1 s after,
  then walks it backwards (browsers cannot play video in reverse: the 100 ms
  tick seeks back by speed × 100 ms when no seek is pending), then forwards
  again; Loop (O) jumps back at the end. Both start at 0.5×; the play button
  becomes Stop; Escape, a scrub, a nudge, a frame step, ⟲ or Live end it.
  The tick calls the latest `seekWall` through an `act` ref. The reviewed
  window is hatched lime on the bar.
- **Broadcast touches**: a "Replay · last 10 s" banner (a green and a lime
  band wipe across, transform/opacity only) on ⟲ and on opening with
  `?back=`; LIVE / REPLAY / VAR REVIEW badge with the speed on every
  picture; the readout next to the clock is now "−0:42" behind the newest
  moment, or LIVE.
- **Save the moment** (`components/save-sheet.tsx`, S): bottom sheet on a
  phone, dialog on a tablet: label (typed or one tap: Double bounce, Glass
  first, Net touch, Ball on the mesh, Let, Point of the match), 10 / 16 /
  30 s around the selected incident or the moment on screen. Then a camera
  flash and a note with Link (copies the share URL) and Open, gone after
  12 s. Replaces `window.prompt`.
- `?back=<s>` opens the replay that far back (the live page's and the
  courts page's instant replay).
- The pictures may shrink to 140 px (was 200) so a landscape phone keeps
  every control on screen with the incident strip open; the keyboard hint
  hides there.

**Live page** (`components/live-grid.tsx`):

- **Live sync**: the tiles are held on the same moment. MediaMTX's live
  playlists have no PROGRAM-DATE-TIME, so each frame is dated by the
  player's distance behind its own live edge (hls.js `latency`, Safari the
  end of `seekable`) plus the Align offset; tiles ahead of the slowest play
  at 0.8–0.98× until they match, more than 2.5 s ahead jumps back. "In sync"
  in the header.
- **hls.js first** (bug found on the way): Chrome now answers "maybe" to
  the HLS MIME type, so the live page took Chrome's own HLS, which left the
  second camera black (paused, readyState 0) with MediaMTX's low-latency
  playlists. Same order as the replay page now.
- Instant replay 10 / 30 / 60 s along the bottom.

**Courts page = the control room**: hero with an on-air panel (REC light,
signal meter, the court clock in Baku time, media server and cameras), the
court card with each end camera's view cone and scan line and a light
running round the border while on air, instant replay 10 / 30 / 60 s,
counters that count up (cameras streaming, hours of replay, saved moments,
top frame rate), "How a review works" (four steps with small animations and
a lime line that fills as you scroll), the three latest saved moments
(`components/clip-card.tsx`, shared with the clips page; `countClips()` in
`lib/clips.ts`), the keyboard shortcuts as keycaps (desk sizes), the ticker.
`components/control-room.tsx` holds the clock, counters, reveals and steps.

Found and fixed on the way: our `@keyframes spin` (the border light) took
the name of Tailwind's `animate-spin`, rotating the whole border pseudo
element (and it would have stopped the replay spinner's rotation) --
renamed `onair-spin`. The step cards overflowed their row and hid the line
under them. The S that opens the save sheet landed in its label field.

**Verified** (dev server, test footage): typecheck, lint, `pnpm build`
clean. Review test (`?back=20`, M, R, Escape, O, S, a tag, save intercepted
in the browser so nothing reached Mongo or MediaMTX): opens at −0:20;
rock goes −1.95 s → +1.0 s at 0.5× then back down; loop wraps from +1.0 s
to −2.0 s; the save request is the 16 s around the incident with the tag
as label; no page errors; all controls on screen at 390×844, 844×390,
820×1180, 1180×820. Phone audit: all checks passed, numbers unchanged
(open 2.4 s, far tap 1.0 s, frame steps exact). Live sync with a scratch
MediaMTX (`record: no`, recordPath in a temp folder; the test footage
untouched, 1052 files) and two looped streams copied without re-encoding
(CPU < 10 %): 15–20 ms apart at rest; one tile knocked 1 s back caught in
~4 s; 3.5 s back caught in one jump (2–12 ms). Courts page screenshots at
1440×900 and 390×844, on air and off air; no horizontal scroll.

**Exported** as public `503026f` (= padel-full e71b1eb, on top of 96587c3, no
Mac commits; secret scan: placeholders only). `infra/` unchanged: the normal
deploy line, no MediaMTX recreate. **Not deployed** until the owner runs it.

## 2026-10-28 — Rebranded as Padel Center Baku: the club's colours, logo and type, a brand front door

The owner: rebrand the live VAR site with the padel center's colours and
branding (padelcenter.az and their tournament poster), make it look
official, with animations, effects and moving parts.

**Brand, measured from padelcenter.az** (headless Chrome, computed styles
and CSS variables): `--black #080808`, `--green #ceff65` (their lime
buttons), `--brand-green #235834` (the wordmark), `#f3ea5d` (the ball);
Satoshi + Bebas Neue + Inter. The site stays dark (the pictures are the
point) and uses Bebas Neue for headings and Inter for text, both in the
club's own stack and both OFL (`next/font/google`, fetched at build time
and served by the site). Satoshi was left out: its licence is not OFL and
the public repo would redistribute it.

- **Tokens** (`app/globals.css`): background near-black, lime `--accent`
  for primary actions / the playhead / the chosen option, the club green
  `--accent-2` with lime text for "keep this" actions (Save, Copy share
  link), `--ball`, `--live` red, status colours. Shared classes: `.display`,
  `.eyebrow`, `.btn` + `.btn-accent` (a light sweeps across on hover) /
  `.btn-brand` / `.btn-live` / `.btn-ghost`, `.seg[aria-pressed]` (speeds,
  camera focus, timeline zoom: the inline `seg()` styles are gone), `.pill`,
  `.dot` (pulses a ring like a broadcast light), `.tile-label`, `.card`,
  `.glass`, `.field`, `.stage` (green glow behind the brand pages, never
  behind the console), focus rings in lime. A `short:` variant for phones on
  their side.
- **Logo** (`public/brand/`): the club's secondary logo from their CDN with
  the green wordmark turned cream for the dark UI (`logo-light.png`), the
  ball monogram redrawn as `ball.svg`; app icons (192, 512, maskable, apple
  180) are the ball on black. Manifest and titles: "Padel Center Baku · VAR
  Replay", `PCB VAR`, per-page titles.
- **Header**: logo (the ball alone on a phone) + a lime VAR tag, Courts /
  Clips with a lime pill that slides to the open page (motion `layoutId`),
  frosted black with a lime-to-green hairline; Sign out as an icon on a
  phone.
- **Login**: "Every point. Every angle." in Bebas over a padel court drawn
  in perspective whose lines draw themselves while a ball rallies across the
  net (SVG `animateMotion` with a short trail), a frosted sign-in card with
  the logo, a ticker of what the product does along the bottom, and the
  club's ball floating on large screens -- grab and throw it, it rolls and
  springs back. Side by side on a landscape phone.
- **Courts**: one wide card while the club has one court (the court
  drawing beside the details from a laptop up), a grid for more. The card
  leans toward the mouse with a lime light following it (mouse only); the
  drawing marks each end camera that is streaming; VAR cameras as rows,
  detector cameras as chips with "n/m streaming"; Replay (lime) and Live.
- **Replay console**: colours, Bebas court name, the clock in Inter tabular
  figures, lucide icons (frame steps, play/pause, ⟲ 10/30/60 s, timeline,
  Save), Play as the one cream button, Live red with a white dot when at
  the live edge and a pulsing red dot otherwise. Layout classes unchanged;
  no motion library here, only CSS transitions on buttons. Scrubber: the
  recorded span in club green, downloaded video lime, a glowing lime
  playhead.
- **Live**: the same strip, a Live pill, and a bouncing-ball "Connecting"
  on each tile until its picture plays.
- **Clips, clip, share**: brand headings, clip cards with a film icon and
  hover lift, an empty state with the ball; players with icons and download
  chips; the share page with the logo and a footer link to padelcenter.az.
  A branded 404 ("Out of the court") and a bouncing-ball loading screen
  between pages.
- `config/courts.json`: club name "Padel Center Baku".
- Libraries: `motion` 12.43.0 and `lucide-react` 1.56.0, pinned exactly
  (motion 13/14 are under three weeks old).
- `prefers-reduced-motion` stops every animation (CSS and motion).

**Kept**: accessible names the audit uses (`Play`/`Pause`, `−10`, `1×`,
`1m`); the clock got a `data-clock` hook (it had been found by
`span.font-mono`), the frame-step buttons are `back one frame` / `forward
one frame`, the replay-last ones `10s` -- `scripts/checks/replay-audit.mjs`
updated to match (it still accepts the old names).

**Verified**: `pnpm typecheck`, `pnpm lint` clean; `pnpm build` (pinned to
six cores, low priority) and a standalone run on :3001 serving the
self-hosted fonts, logo, icons and manifest. Screenshots of login, courts,
replay, live, clips, clip, share and 404 at 390×844, 844×390, 820×1180,
1180×820 and 1440×900: no horizontal scroll anywhere; the replay console
still fits a 390×844 phone and an 844×390 landscape phone without
scrolling. Phone audit (10 Mbps / 60 ms, 4.4 h test footage): open 2.3 s,
tap 1.5 h back 1.0 s, drag back 2.4 s, −10 ≈ 1.0 s, frame steps 85–163 ms
exactly −40 ms on both cameras, ⟲ 10s 1.0 s, −1 s 16–79 ms, heap 55 MB,
all checks passed (same as 2026-10-21). Live tiles and clip playback were
seen without video locally (no media server here, clip files live on the
server).

**Exported** to the public repo as `96587c3` (= padel-full cc8a8ef; its main
was the last export baa7111, no Mac commits in between; secret scan: only
the templates' `USER:PASS` placeholders). `infra/` unchanged, so the normal
deploy line is enough (no MediaMTX recreate). **Not deployed** until the
owner runs the server commands (HANDOVER §7).

## 2026-10-26 — Detector cameras LIVE on the site: first camera recorded

After `up -d --force-recreate mediamtx` on the server (the owner), the
detector PC's 45 s test (`live_multi.py run --var --seconds 45`, this PC's
camera, at home) was recorded: `/api/health` -> `"court1-det-local": 4`
next to `court1-north` / `court1-south` (796 / 798 files, still growing after
the recreate -- the club relay reconnected by itself). Detector PC CPU mean
18 %. The replay / live tiles and Align on the real site are the owner's to
look at (no production login from here).

## 2026-10-26 — Deploy trap: a changed mediamtx.yml needs the media server recreated

The owner deployed baa7111 with the usual commands; the detector PC's first
`--var` run (45 s, one camera) reached the server but nothing was recorded,
and a 2 s test publish to `court1-det-local` was refused ("I/O error" on
open). `infra/mediamtx.yml` is a single-file bind mount
(`./mediamtx.yml:/mediamtx.yml:ro`) into the prebuilt
`bluenviron/mediamtx` image: `up -d --build mediamtx web` finds nothing to
rebuild or recreate, and `git reset --hard` replaced the file with a new
inode, so the running MediaMTX still has the old config without the four
detector paths. Fix: `up -d --force-recreate mediamtx`. Written into
HANDOVER §7, docs/DEPLOY.md and the CLAUDE.md lessons; no code change.

## 2026-10-26 — The in/out detector cameras as extra angles: live, replay, side by side, one clock

The owner: the VAR site should also show the in/out system's detector
cameras, live and rolled back like the club's cameras, synced to the same
moment, all side by side.

- **Cameras**: `config/courts.json` gains `court1-det-local`, `-pi3cam1`,
  `-cam1`, `-cam2` (`group: "detector"`, `fps: 60`; the club's two get
  `group: "var"`); `infra/mediamtx.yml` the same four paths (record: yes).
  The detector PC pushes them over RTMP with the club relay's publish user
  (padel_analytics `live_multi.py run --var`: NVENC H.264, 60 fps, 4 Mbps,
  a `fifo` output that drops instead of ever blocking the detector).
- **Clock offsets** (`lib/offsets.ts`, Mongo `camera_offsets`): the two
  camera systems reach MediaMTX with different delays, so each camera has an
  offset added to all its recorded times. `/api/replay/state` returns spans
  already shifted and `offsetMs`; `CameraPlayer` (`offsetMs`, `setOffset`)
  shifts its program-date-time mapping everywhere (`wallAt`, `timeAt`,
  `liveEdge`, `ranges`, `buffered`); `lib/clips.ts` cuts each camera at
  `start − offset`. `PUT /api/replay/offset` (staff/admin, ±30 s).
- **Replay page**: N cameras -- grid 1 / 2 (stacked in portrait) / 2 × 2 /
  3 × 2; focus All (Both with two) / VAR / Detector / one camera (buttons with
  two cameras, a picker with more); a detector camera gets a tile only when
  it recorded something in the buffer (the PC is at the court a few hours a
  week); frame step from the fastest camera on screen (a 60 fps detector
  camera steps 1/60 s, the 25 fps ones hold their frame); per-camera fps in
  the follower threshold; **Align** panel: pick a camera, ±1 s / ±0.1 s /
  ±1 frame against the others (the others stay on the moment, this one's
  picture moves), "Save for everyone", Undo; unsaved drafts survive the 5 s
  state poll. `window.__replayState` (dev / ?debug): leader, held followers.
- **Live page**: tiles for the club's cameras always, detector cameras only
  while publishing (`mediamtxStatus`); same N-camera grid.
- **Verified on the dev PC** (scratch MediaMTX recording to a temp folder,
  `pnpm sim` as the north camera, an in/out clip through the real capture
  code with `--uplink` as `court1-det-file1`, `pnpm dev` with a scratch
  courts file and a throw-away `var-replay-test` database -- dropped after;
  headless Chrome): both cameras on the same moment 13 ms apart paused and
  after −10 s; one frame step = 16 ms; VAR / Detector focus show one tile
  each; Align +0.1 s → offset 100, re-lined up 15 ms apart, saved offset
  served by `/api/replay/state`; live page with both cameras playing; phone
  390 × 844 no sideways scroll; a camera with no recordings gets no tile.
  Found on the way: the uplink first reconnected every 2 s with nothing
  recorded -- through `fifo` the encoder gave no global header and the flv
  muxer failed ("extract_extradata"); `-flags +global_header` fixed it. A
  `next dev` Turbopack internal error hung one route's compile; a restart
  cleared it (not a code fault). `pnpm typecheck` / `pnpm lint` clean.
- **Exported** to the public repo as `baa7111` (= padel-full 3956d5c; its
  main was the last export 870f6f3, no Mac commits in between; secret scan:
  only the templates' `USER:PASS` placeholders). **Not deployed** until the
  owner runs the server commands (HANDOVER §7);
  the MediaMTX container must restart for the new paths. The detector PC
  needs `VAR_SERVER` and `VAR_PUBLISH_PASS` (= the server's `PUBLISH_PASS`)
  in `padel_analytics/inout/pi_relay/.env`.

## 2026-10-25 — HANDOVER.md, every doc brought to the current state, the replay audit committed

The owner asked for a handover file another agent can start from, and for
all the documents to say what is true now.

- **`HANDOVER.md` (new)**: state on 2026-10-25, what the site does, where
  everything lives (repos, server, database, club PC — no secrets), how it
  works end to end with the replay pipeline step by step, a code map, every
  route and who may call it, configuration and invariants, how to ship (export
  and the server commands), a symptom → cause → check table, how to verify,
  the performance baseline, known limits, open items in order, the rules, and
  the history on one screen.
- **Deploy check** (from outside, no server access): the server runs the
  2026-10-21 version — `/api/health` has the new field — but showed
  `"recordings": {"dir": "/recordings", "cameras": {}}` on Sunday 15:00: the
  folder is mounted and readable, and empty. MediaMTX 1.20.1's cleaner
  deletes empty camera folders (`deleteEmptyDirs` in
  `internal/recordcleaner/cleaner.go`), and the `bluenviron/mediamtx:1.20.1`
  image's working directory is `/` (read from Docker Hub), so
  `./recordings` is the shared volume: the likely reading is that the cameras
  had not streamed for 4 h. Not confirmed; HANDOVER §1/§8 and DEPLOY.md
  "Replay shows nothing" have the two-minute check.
- **Found while writing it:** AutoReload never reloads while a video plays,
  and the replay page now plays continuously — a courtside tablet left
  running keeps old code after a deploy. Listed as open item 2 with a fix
  idea; not changed.
- **`scripts/checks/` (new)**: `replay-audit.mjs` — the phone audit behind
  the 2026-10-21 numbers, cleaned up (env knobs, playwright-core resolved
  from the current folder, exit code 1 on a FAIL); `mint-session.mjs` — a
  session cookie for a local production build; `README.md` — how to run
  both, the production-build procedure, the live-edge test with a growing
  recording, and how not to lose the 4.4 h test footage. Re-run against the
  dev server on the test footage at 20 Mbps: all checks passed, exit 0;
  the minted cookie gave 200 on `/api/replay/state`, no cookie 401.
- Brought up to date: `README.md` (status, the public clone no longer
  force-pushed, `scripts/checks/`), `CLAUDE.md` (HANDOVER first, status,
  checks), `PLAN.md` (status block, architecture diagram and replay bullet,
  "replayable after" ~3–4 s, viewer download), `docs/DEPLOY.md` (clone
  command for the public repo, the commands run on the server's shell not
  PowerShell, "Replay shows nothing"), `docs/CAMERA_SETUP.md` (what runs
  today), `docs/CLUB_VISIT_2026-09-04.md` (marked historical, its "Next
  visit" list still open), the workspace `CLAUDE.md` (var-replay bullet).
- `pnpm lint` clean (the new scripts included); no app code changed.

## 2026-10-21 — Replay is one timeline over the whole buffer ("like YouTube"); audit of why rolling back failed

The user, after the 2026-09-04 streaming fix had been live for weeks:
rolling back to watch a part of the recording "doesn't work, so slow and
laggy, most times it doesn't do anything"; wanted a player "like YouTube"
where every part of the video can be watched. Nothing changes on the club
PC: the relay keeps pushing the same streams.

**Audit of the old page** (40 s windows through MediaMTX `/get`), measured
in headless Chrome as a phone (390×844, 10 Mbps, 60 ms) over the 4.4 h local
recording:

| step | result |
|---|---|
| the 4 h bar on a phone | 39 s per pixel |
| pick 1.5 h back | picture after 3.4 s, paused (user picks started paused) |
| drag the window slider back 20 s right after | **16.4 s** of blank "waiting": the 25 s run-up downloaded after the 15 s after the moment; 20 seeks per camera for one drag |
| roll back more than 25 s before a pick | impossible without another pick on the 39 s/px bar |

**New design.** The server reads MediaMTX's recording files itself and serves
each camera's whole buffer as one HLS stream; the page plays it with hls.js.

- `lib/recordings.ts` (new): indexes `RECORDINGS_DIR/<camera>/*.mp4` from the
  moof boxes only (1 052 files per camera in 0.25–0.6 s; a refresh with
  nothing new ~1 ms; a file that did not change is not re-read), cuts files
  into ~2 s keyframe-aligned segments (two GOPs at the cameras' I-frame
  interval 25), and serves a live playlist with delta updates
  (CAN-SKIP-UNTIL 30 s: a reload is ~1.4 KB instead of 27 KB gzipped / 549 KB
  raw for 4 h), init sections (video track only, durations zeroed — one
  content hash per session) and segments remuxed to one moof+mdat with the
  stream's own timestamps (mtxi DTS) and wall clock from mtxi NTP, so a
  segment URL always yields the same bytes (`immutable` caching). Sessions
  (publisher reconnects, codec changes, gaps) become EXT-X-DISCONTINUITY;
  a camera that stopped streaming gets EXT-X-ENDLIST after 10 s of silence.
- Routes: `/api/replay/<camera>/index.m3u8?e=<epoch>` (410 when the server
  restarted and renumbered), `/init/<key>.mp4`, `/seg/<file>/<from>-<to>.m4s`,
  `/api/replay/state?court=` (recorded spans for the bar). The old
  `/api/video/get` and `/api/video/segments` routes, `lib/window-loader.ts`,
  `lib/mp4-stream.ts` and `components/timeline.tsx` are gone; clips still cut
  through MediaMTX `/get`.
- `lib/replay-player.ts` (new): one hls.js player per camera (the browser's
  own HLS on an iPhone without ManagedMediaSource; `?engine=native|hls`
  forces one), mapping video time ↔ wall clock through the fragments'
  program-date-time, coalesced seeks, the frame on screen via
  requestVideoFrameCallback.
- `components/scrubber.tsx` (new): one bar over the whole buffer, zoom chips
  All / 30m / 5m / 1m (1 m = 0.16 s per pixel on a phone) with an overview
  strip, time bubble above the finger, drag to look (the picture follows
  inside downloaded video; elsewhere it fetches where the finger rests),
  release to stay.
- `components/replay-console.tsx` rewritten: opens playing 30 s before the
  newest moment; −10 / −1 s / frame / play / +1 s / +10, ⟲ 10/30/60 s,
  ● Live (6 s behind the newest segment so playback never stalls at the
  edge), speeds, save; keyboard J/K/L, arrows, Home/End; play state kept
  across seeks; per-tile spinner after 300 ms of waiting.
- `instrumentation.ts` (new): builds the index at server start (3.1 s for
  2 × 1 052 files in the production build).
- `infra/docker-compose.yml`: `web` mounts the `recordings` volume read-only
  at `/recordings` (`RECORDINGS_DIR`). `/api/health` reports the files it
  sees per camera. `.env.example`, `docs/DEPLOY.md`, README, CLAUDE.md, PLAN.

**Bugs found while driving it** (each reproduced in the browser first, then
fixed; CLAUDE.md "Lessons" has the short form):
1. hls.js `progressive: true` + live reloads: the reload copied a
   half-parsed segment's duration (0.04 s) into the playlist, every other
   segment, and hls.js's timeline drifted. Progressive off, one moof per
   segment.
2. hls.js finishes the old segment on a *backward* seek (it only aborts on
   forward seeks): rolling back waited for it. Seeks into undownloaded video
   now stop and restart loading at the target.
3. Second camera: it kept downloading its previous target, then played the
   wrong moment and re-seeked; on 10 Mbps its own catch-up seeks aborted its
   download for ever. Now it waits (loading stopped) until the first camera
   shows a jump's frame, retargets without aborting for small moves (frame
   steps), and catches up by seeking ahead at most every 1.5 s.
4. Resuming the second camera before seeking made hls.js fetch the old
   position first: seek, then resume.
5. A playlist that does not change made hls.js reload it in full every
   second (3.4 MB in a minute): ENDLIST for stopped cameras; the page starts a
   new player when the camera records again.
6. `play()` on an ended video restarts it from the oldest moment (HTML spec):
   at the end of a stopped camera the page jumped 4 h back. It stops now.
7. Before hls.js reaches its start position the element is at time 0 — the
   oldest moment: the clock briefly showed it, and a camera created then
   would have opened 4 h back. Not trusted until positioned.
8. Paused, the clock showed the playhead, which can sit between frames: a
   frame step read −20 ms. It now shows the frame on screen; steps read −40.
9. Focus "North" → "Both" resumed the hidden camera where it stopped; a
   hidden camera focused alone never resumed. Both go through align-then-load.
10. The second camera at the very newest moment flashed "no recording"
    (its last segment can end a segment earlier): it waits at its edge.
11. Next dev gives every route its own module copy: the index lives on
    `globalThis` (restart the dev server after editing `lib/recordings.ts`).

**After**, same phone profile (dev server; the production build gave the
same numbers):

| step | 10 Mbps | 20 Mbps |
|---|---|---|
| open → playing | 2.4 s | 1.4 s |
| tap 1.5 h back | 0.95 s, 1 MB | 0.6 s |
| drag back 20 s at 1 m zoom (from drag start, incl. the ~1 s drag) | 2.2 s | 1.8 s |
| −10 into undownloaded video | ~1.0 s each, 1 MB | ~0.6 s |
| −1 s inside what has played | 18–135 ms | 27–123 ms |
| frame step | 74–84 ms (the first after a jump up to 240 ms), exactly −40 ms, both cameras on the same frame | 81–163 ms, same |
| second camera on the leader's frame after a burst of jumps | 1.4 s | 0.6 s |
| 10 s at 1× | no follower re-seeks, rates 1.00 | same |
| ⟲ 10 s from 1.5 h back | 1.0 s | 0.55 s |

Live test (MediaMTX recording `pnpm sim` into a scratch folder, 25 Mbps
desktop): the bar's end grows 1 s per second, playlist reloads are deltas
only (~1 KB/s per camera), ● Live 20 s with no stalls and the cameras 29 ms
apart, ⟲ 10 s at live 150 ms, cameras stopped → both playlists closed and no
reloads, cameras back → players resume, a tap before the gap lands there.
Production build (`.next/standalone` on :3001, session cookie signed with the
local AUTH_SECRET — no user created in Mongo): the 10 Mbps phone audit passes
whole, JS heap 17 MB, unauthenticated replay routes 401. Layout at 390×844,
844×390 (all controls on one line), 820×1180, 1180×820: no horizontal scroll;
screenshots looked at. `pnpm typecheck`, `pnpm lint`, `pnpm build` clean.
CPU stayed under 30% throughout (build pinned to 6 of 16 cores).

**Not tested:** Safari and iPhone (no device here): hls.js through
ManagedMediaSource on iOS 17.1+, the browser's own HLS on older iPhones —
`?engine=native` / `?engine=hls` switch between them. The real cameras'
2560×1440 stream: the simulator is 1280×800 at the same 4 Mbps with the same
1 s GOP.

**Known limit:** two 4 Mbps cameras need ~9 Mbps at 1× playback. On a 10
Mbps phone line the second camera keeps up only just; focusing one camera
halves it. The lever is the camera bitrate (or relaying the NVR substreams
for a lighter "Both" view).

**Deploy** (VPS): `git fetch origin && git reset --hard origin/main`, then the
`up -d --build mediamtx web` line in docs/DEPLOY.md; `/api/health` must list
the camera folders under `recordings`.

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
