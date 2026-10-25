# Padel VAR — handover

Written 2026-10-25 for the next agent or developer. It is the one document to
read first: what the product is, what is running where, how replay works
inside, how to change and verify it, and what is open. Details live in the
files it points to; `COMMIT_LOG.md` (newest first) has the reasoning behind
every change.

Reading order: this file → `CLAUDE.md` (rules, invariants, lessons) → the top
two entries of `COMMIT_LOG.md` → `docs/DEPLOY.md` before touching the server
→ `docs/CAMERA_SETUP.md` §0 and `infra/club-relay/README.md` before touching
anything at the club.

---

## 1. State on 2026-10-25

| | |
|---|---|
| site | **https://72-62-236-90.sslip.io** — live since 2026-09-03 |
| version on the server | the 2026-10-21 replay rework (public repo `c23b905` = private workspace `f430e7f`), deployed by the owner. Confirmed from outside: `/api/health` has the new `recordings` field. |
| cameras | two court cameras, relayed from the club since 2026-09-04 by a PC at the club (scheduled task, survives reboots) |
| replay | one continuous timeline per camera over the last 4 h (§4) |
| **open check** | `/api/health` on 2026-10-25 15:00 showed `"recordings": {"dir": "/recordings", "cameras": {}}` — the site sees the recordings folder, but it was empty. MediaMTX deletes camera folders once the last file is older than 4 h, so this most likely means **the cameras had not streamed for 4 h** (a Sunday; club PC or relay off). It can also mean the volume is mounted wrong. §8 "Replay shows nothing" has the two-minute check. Not verified yet: the new replay page with the real cameras. |

## 2. What it does (for the people using it)

A referee or player at the court opens the site on a phone or tablet:

- **Courts** page: each court, its cameras, "streaming / no stream".
- **Replay** (`/courts/court1`): both ends of the court side by side (stacked
  on a phone in portrait), on one clock. Opens playing 30 s before the newest
  moment. One bar covers the whole 4 h buffer; the chips **All / 30m / 5m /
  1m** zoom it (1m ≈ 0.16 s per pixel on a phone). Drag anywhere, release to
  stay; buttons −10 s, −1 s, frame back, play/pause, frame forward, +1 s,
  +10 s; ⟲ 10/30/60 s (replay the last N seconds); ● Live; speeds 1×, 0.5×,
  0.25×, 0.1×; pinch / Ctrl-scroll zoom on each picture; "Both / North end /
  South end" to focus one camera (the other stops downloading); Save.
  Keyboard: Space/K, J/L (±10 s), ←/→ (one frame), Shift+←/→ (±1 s),
  Home/End.
- **Save** cuts 16 s around the moment from both cameras into MP4 files and
  gives a **share link** that works without a login (`/share/<token>`).
- **Live** (`/courts/court1/live`): both cameras live (a few seconds late).
- **Clips**: the saved moments.

It is a replay tool for disputes (double bounce, glass first, a ball a metre
out). The cameras record 25 fps — at that rate a close line call falls
between frames — so it never claims automatic line calling. Keep that
framing in anything user-facing.

## 3. Where everything is

| thing | where |
|---|---|
| source of truth | private repo `padel-full`, folder `var-replay/` (the dev PC: `C:\Users\Admin\Desktop\padel\var-replay`). **Never push it** — the owner's standing rule. |
| what the server runs | public repo **github.com/Elchin-Novruzov/VAR-sys-4-ip-cams** — a snapshot of `var-replay/` only. Pushing here is allowed (the owner authorised it). The owner may also commit here from a Mac clone: look for such commits before exporting (§7). |
| server | Hostinger VPS **72.62.236.90**, Ubuntu 25.10, 8 GB, shared with other services (two Mongos, two APIs, MSSQL) behind a **host Caddy**. Project at `/root/padel-var` (a clone of the public repo); containers `infra-mediamtx-1` and `infra-web-1`. **No SSH key from the dev PC** — the owner logs in with the root password or Hostinger's browser terminal and runs the commands. |
| server secrets | `/root/padel-var/.env`: `DOMAIN`, `PUBLISH_PASS` (camera publish password), `MONGODB_URI`, `AUTH_SECRET`, `AUTH_URL`. Never in git. |
| database | the labeling site's MongoDB server, database `var-replay`, collections `users`, `clips`. Logins are created with `pnpm seed-user`. The owner has the admin login. |
| club relay | Windows PC `DESKTOP-DK4FDF8` at the club (AnyDesk), `C:\padel-relay\` (`relay.ps1`, `relay.env` with the NVR's relay user password — never in git, `logs\`), scheduled task `padel-relay` as SYSTEM. It reaches the NVR (Dahua, 192.168.77.100) over its **Wi‑Fi**. **North = NVR channel 2, south = channel 8 — never swap.** Full facts: `docs/CAMERA_SETUP.md` §0. |
| test footage | dev PC `var-replay/recordings/court1-*/`: 4.4 h of simulator recording (2026-09-03, 1 052 files per camera) — the only long buffer for testing. `pnpm mediamtx` would delete it (4 h retention); see `scripts/checks/README.md`. |

## 4. How it works

```
CLUB                               VPS (docker compose + host Caddy)                  BROWSER
cameras ─RTSP─► NVR ◄─RTSP─ relay PC ─RTMP─► MediaMTX :1935
                (ch2, ch8)  (ffmpeg -c copy)   ├ records fMP4 to the `recordings` volume
                                               │   /recordings/<camera>/<YYYY-MM-DD_HH-MM-SS-ffffff>.mp4
                                               │   1 s parts, 15 s files starting on a keyframe,
                                               │   deleted after 4 h
                                               ├ live HLS :8888 (internal) ──► web /api/video/hls ──► live page
                                               └ playback /get :9996 (internal) ─► web: saving clips
                                    web (Next.js, 127.0.0.1:3000) ◄── Caddy HTTPS ◄────────────── phone / tablet
                                      reads /recordings itself (read-only mount) for replay
                                      MongoDB: users, clip records; clip files in the `clips` volume
```

Only 80/443 (host Caddy), 1935/tcp (RTMP in) and 8890/udp (SRT, unused) are
open. Every video byte the browser gets comes through a Next.js route that
checks the session and that the camera is in `config/courts.json`.

### Replay, end to end (since 2026-10-21)

1. **Recording files.** MediaMTX's fMP4 files: `ftyp`, `moov` (video track,
   timescale 90 000; a `udta/mtxi` box with the stream id, segment number,
   the stream time and the **wall-clock time** of the file's start), then one
   `moof`+`mdat` per second. When a file closes, MediaMTX writes its duration
   into `mvhd` — that is how a finished file is recognised.
2. **Index** — `lib/recordings.ts`, one `CameraIndex` per camera, kept on
   `globalThis`. Refreshed at most once a second when asked: `readdir`, drop
   deleted files, re-read only the file still being written, parse new files
   (box headers and `moof`s only, never the video bytes). Consecutive files of
   one stream with the same codec setup and no gap form a **run**; a new run
   is a discontinuity. Each file is cut into **segments of whole GOPs, at least
   2 s** (the cameras key every second, so 2 s; a 15 s file gives 7 × 2 s +
   1 × 1 s). Segments get sequence numbers that only ever grow. The index has
   an **epoch** (random per process); built at server start by
   `instrumentation.ts` (~3 s for 2 × 1 000 files).
3. **Playlist** — `GET /api/replay/<camera>/index.m3u8?e=<epoch>`: a live HLS
   playlist of the whole buffer (version 9, target duration 2, independent
   segments, `EXT-X-MAP` per run, `EXT-X-PROGRAM-DATE-TIME` at every file start,
   `EXTINF` with 6 decimals). `EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=30`: once the
   player has it, it asks with `_HLS_skip=YES` and gets only the last 30 s
   (~1.4 KB instead of 27 KB gzipped / 550 KB raw for 4 h). A camera whose last
   file is closed and untouched for 10 s gets `#EXT-X-ENDLIST`. Wrong epoch →
   **410** (the server restarted and renumbered; the page starts that player
   again).
4. **Segments** — `GET /api/replay/<camera>/seg/<file>/<from>-<to>.m4s`:
   frames `[from, to)` of one recording file, remuxed into one `moof`+`mdat`
   with the stream's own timestamps. The same URL always returns the same
   bytes (`immutable` caching). ~1 MB per camera per segment at 4 Mbps.
   `GET …/init/<hash>.mp4`: the init section (video track only).
5. **Player** — `lib/replay-player.ts`, one `CameraPlayer` per camera: hls.js
   (MSE, or ManagedMediaSource on iOS 17.1+); the browser's own HLS on an
   iPhone without either. `?engine=native|hls` forces one. Maps video time ↔
   wall clock through the fragments' program-date-time; coalesces seeks; a
   seek into video that is not downloaded drops the running download;
   `frameTime` = the frame on screen (requestVideoFrameCallback). Buffers
   10 s ahead while playing, 4 s while paused, keeps 60 s behind.
6. **Console** — `components/replay-console.tsx`: polls
   `/api/replay/state` every 5 s (recorded spans, epoch, ended); a 100 ms tick
   keeps the videos on the user's intent (play/pause) and the **second camera
   on the first one's clock**: after a jump it waits with downloading stopped
   until the first camera shows its frame (no bandwidth fight); while playing
   it is held in step by ±20 % speed nudges, and only seeks (ahead, at most
   every 1.5 s) when more than 0.5 s off. ● Live plays 6 s behind the newest
   segment so it never stalls at the edge. `components/scrubber.tsx` is the bar.

The old design (until 2026-10-21) fetched 40 s windows through MediaMTX `/get`;
rolling back past a window's start re-downloaded ~40 MB (16 s of frozen
picture on a phone on 4G, measured). Don't go back to it.

### Other flows

- **Live**: `components/live-grid.tsx` plays MediaMTX's own low-latency HLS
  through `/api/video/hls/<camera>/…` (hls.js, or native on Safari).
- **Save / share**: `POST /api/clips` → `lib/clips.ts` asks MediaMTX `/get`
  (`format=mp4`) for each camera, writes `clips/<id>/<camera>.mp4`, stores a
  Mongo doc with a random share token. `/share/<token>` and
  `/api/clips/shared/<token>/file` are public; files are served with Range.
- **Auth**: Auth.js credentials (bcrypt users in Mongo), JWT sessions (8 h,
  30 days with "remember me"); `proxy.ts` guards everything except the public
  prefixes. `DEV_LOGIN_*` (`dev@local` / `dev`) works only in development.
- **AutoReload** (root layout): reloads a page when `/api/version` reports a
  new build — but never while a video plays (see §10).

## 5. Code map

| path | what |
|---|---|
| `lib/recordings.ts` | recording-file index, run/segment cutting, playlist, init sections, segment remux |
| `lib/replay-player.ts` | `CameraPlayer`: hls.js/native player, time ↔ wall clock, seeks, loading control |
| `components/replay-console.tsx` | replay page: players, two-camera sync, transport, focus, save, keyboard |
| `components/scrubber.tsx` | the timeline bar with zoom chips |
| `components/zoom-pan.tsx` | pinch / wheel zoom and pan on a picture |
| `components/live-grid.tsx`, `clip-players.tsx`, `auto-reload.tsx` | live page, clip and share players, reload on a new build |
| `app/api/replay/…` | playlist, init, segment, state routes (§6) |
| `app/api/video/hls/…` | live HLS proxy |
| `app/api/clips/…` | save, list, serve clips; public shared-clip files |
| `app/api/health`, `app/api/version` | deployment doctor (public), build id |
| `lib/mediamtx.ts` | MediaMTX client: clip cutting (`/get`), live HLS, "who is streaming" (API) |
| `lib/clips.ts`, `lib/courts.ts`, `lib/mongodb.ts`, `lib/http.ts`, `lib/time.ts` | clips, `config/courts.json`, Mongo, file/gzip responses, clock formatting |
| `instrumentation.ts` | builds the replay index at server start |
| `proxy.ts`, `auth.ts` | auth middleware, Auth.js |
| `config/courts.json` | courts and camera paths, `retentionHours` |
| `infra/mediamtx.yml` | media server config (paths, recording, auth) |
| `infra/docker-compose.yml` + `docker-compose.hostproxy.yml` | the VPS stack; the overlay is what runs (host Caddy) |
| `infra/club-relay/` | the club PC's relay script, its README, LAN scanners |
| `scripts/` | `mediamtx.ts` (local server), `sim.ts` (fake cameras), `seed-user.ts`, `checks/` (browser audit) |

## 6. HTTP routes

| route | access | purpose |
|---|---|---|
| `/login`, `/share/<token>`, `/api/clips/shared/<token>/file`, `/api/version`, `/manifest.webmanifest` | public | login, shared clips, build id |
| `/api/health` | public | env presence, `recordings.cameras` (files per camera folder; `null` = folder unreadable) |
| `/courts`, `/courts/<slug>`, `/courts/<slug>/live`, `/clips`, `/clips/<id>` | session | pages |
| `/api/replay/state?court=<slug>` | session | per camera: epoch, recorded spans, newest moment, ended |
| `/api/replay/<camera>/index.m3u8?e=<epoch>` | session | replay playlist (`_HLS_skip=YES` → delta) |
| `/api/replay/<camera>/init/<hash>.mp4` | session | init section |
| `/api/replay/<camera>/seg/<file>/<from>-<to>.m4s` | session | media segment |
| `/api/video/hls/<camera>/<file>` | session | live HLS from MediaMTX |
| `/api/clips` (GET, POST), `/api/clips/<id>/file?camera=` | session | clips |

## 7. Operating it

**Configuration.** Env vars (`.env.example` documents each): `MONGODB_URI`,
`AUTH_SECRET`, `AUTH_URL`, `DEV_LOGIN_*` (dev only), `MEDIAMTX_PLAYBACK_URL`,
`MEDIAMTX_HLS_URL`, `MEDIAMTX_API_URL`, optional `MEDIAMTX_READ_USER/PASS`,
`COURTS_FILE`, `CLIPS_DIR`, **`RECORDINGS_DIR`** (root of MediaMTX's
`recordPath`; Docker sets `/recordings`). Server-only: `DOMAIN`,
`PUBLISH_PASS`. Invariants: camera paths in `config/courts.json` = `paths:`
in `infra/mediamtx.yml`; `retentionHours` = `recordDeleteAfter`;
`recordFormat: fmp4`.

**Ship a change** (the dev PC cannot reach the server):

1. Commit in `padel-full` with a `COMMIT_LOG.md` entry. Do not push it.
2. Export to the public repo as a normal commit on top of its `main`
   (no force-push since 2026-10-21):
   ```
   git ls-remote https://github.com/Elchin-Novruzov/VAR-sys-4-ip-cams.git refs/heads/main
   # if it is not the last export, the owner pushed from the Mac: bring those
   # commits into padel-full first
   git clone https://github.com/Elchin-Novruzov/VAR-sys-4-ip-cams.git <tmp>/pub && cd <tmp>/pub
   git rm -rq . && git -C <padel-full> archive HEAD:var-replay | tar -x -C .
   git add -A && grep -rIl -iE "mongodb://[^ ]*@|ghp_[A-Za-z0-9]{20}" . --exclude-dir=.git   # must print nothing
   git -c user.name="<from padel-full>" -c user.email="<from padel-full>" commit -m "Snapshot of var-replay at padel-full <sha>: …" && git push origin main
   ```
3. The owner runs on the server (in **its** shell — pasting this into Windows
   PowerShell on the dev PC fails on `&&`, and the `reset` would be harmful
   there):
   ```
   ssh root@72.62.236.90
   cd /root/padel-var
   git fetch origin && git reset --hard origin/main
   docker compose -f infra/docker-compose.yml -f infra/docker-compose.hostproxy.yml --env-file .env up -d --build mediamtx web
   ```
   `reset --hard` because older exports rewrote the history; `.env` is
   untracked and survives. Both compose files are always needed.
4. Check `https://72-62-236-90.sslip.io/api/health`, then the replay page.

**Look at it** (on the server, in `/root/padel-var`, with both `-f` files):
`… ps`, `… logs --tail 50 mediamtx` (`is publishing to path 'court1-north'`
= a camera is in), `… exec web ls -la /recordings /recordings/court1-north`.

**Add a court or camera:** `config/courts.json` and `paths:` in
`infra/mediamtx.yml`, then ship. The relay's `CAMERAS=` on the club PC
decides what is pushed.

**The club PC** (AnyDesk): `Get-ScheduledTaskInfo -TaskName padel-relay`
(LastTaskResult 0), `Get-Process ffmpeg` (one per camera), logs in
`C:\padel-relay\logs\`. Steps and pitfalls: `infra/club-relay/README.md`.

## 8. When something is wrong

| symptom | likely cause | check / fix |
|---|---|---|
| Replay shows "nothing recorded yet" / `/api/health` → `"cameras": {}` | cameras not streaming for ≥ 4 h | Courts page "no stream" → club PC: on? on its Wi‑Fi? `padel-relay` task running? (§7). Within ~30 s of streaming, folders reappear. |
| Courts says streaming, but `"cameras": {}` stays after a minute | the `web` container does not see MediaMTX's volume | `docker inspect infra-web-1 --format '{{json .Mounts}}'` must show the compose `recordings` volume at `/recordings`; redeploy with **both** compose files |
| `/api/health` has no `recordings` field | old build | ship again (§7) |
| `"cameras": null` | `/recordings` missing or unreadable | mount missing — redeploy |
| Courts says "media server unreachable" | `mediamtx` container down | `… ps`, `… logs mediamtx`, `… up -d mediamtx web` |
| One tile says "no recording at this moment" | that camera has a gap there (the relay lost one camera) | relay log for that camera on the club PC |
| Tiles say "reconnecting…" for a second or two | the server restarted (new epoch) | none; the page restarts its players |
| "This browser cannot play the replay stream" | no MSE and no native HLS | Chrome, Edge, Safari, Firefox all work |
| Something odd only on an iPhone / iPad | untested engine path | try the page with `?engine=native`, then `?engine=hls`; report which works |
| Stutter with both cameras on a phone | two 4 Mbps streams need ~9 Mbps | focus one camera ("North end" / "South end"); lasting fix in §10 |
| South end smears fast balls | channel 8 shutter still automatic | next club visit, §10 |

## 9. Changing and verifying

Local: `pnpm install`, `cp .env.example .env.local`, then `pnpm dev` (the
site; replay reads `./recordings`), `pnpm mediamtx` + `pnpm sim` for live
fake cameras (**not** on top of the test footage — `scripts/checks/README.md`).
`pnpm typecheck`, `pnpm lint` before committing; `pnpm build` for the
production build (pin it to a few cores on this PC: under 60 % CPU or it
overheats). **Restart the dev server after editing `lib/recordings.ts`**
(its index survives hot reloads).

There is no test suite. Replay is verified with
`scripts/checks/replay-audit.mjs` (phone audit, OK/FAIL per step) and the
procedures in `scripts/checks/README.md` (production build with a minted
session cookie, a growing recording for the live edge). Layout: no horizontal
scroll at 390×844, 844×390, 820×1180, 1180×820, and look at screenshots.

Baseline, phone on 10 Mbps / 60 ms, 4.4 h test footage (2026-10-21):

| step | before the rework | now |
|---|---|---|
| tap 1.5 h back | 3.4 s, paused | ~1.0 s, keeps playing, 1 MB |
| drag back 20 s | 16.4 s | ~2.2 s from drag start |
| −10 s into undownloaded video | impossible past 25 s | ~1.0 s |
| −1 s / one frame inside played video | — | < 150 ms; frame steps exactly −40 ms on both cameras |
| ⟲ 10 s from far back | — | ~1.0 s |
| playlist traffic in a session | — | < 100 KB |

## 10. Known limits and open items

Not tested (no device or footage here): **Safari / iPhone / iPad**, and the
new player on the **real 2560×1440 cameras** (the simulator is 1280×800 at
the same 4 Mbps and the same 1 s keyframes).

Open, roughly in order:

1. **Confirm replay on the real cameras** — `/api/health` lists both camera
   folders with counts; on a phone: open, far tap, drag back, frame steps,
   ⟲ 10 s; an iPhone too (§8 if not).
2. **AutoReload never fires while a video plays**, and the replay page now
   plays continuously — a courtside tablet left running keeps old code after a
   deploy until someone pauses it. Fix idea: when a new build is known and the
   page is idle (no touch for N minutes), reload and reopen at the same moment
   (e.g. a `?t=` parameter).
3. **Bandwidth of the "Both" view** on weak phone lines (two 4 Mbps streams).
   Options: lower the cameras' bitrate on the NVR, or relay the NVR's sub
   streams as extra paths for the side-by-side view and switch to the main
   stream when a camera is focused or zoomed.
4. **Next club visit** (`docs/CLUB_VISIT_2026-09-04.md`, "Next visit"):
   channel 8 shutter 1/500 at the NVR's own monitor; find the second router and
   **cable the club PC** to it (the relay rides on Wi‑Fi today); upload speed
   test; what channel 3 shows; photos; relay health and log size (ffmpeg
   appends to `C:\padel-relay\logs\` for ever).
5. **Courtside tablet** (phase 4) and a real domain instead of
   `72-62-236-90.sslip.io` (change `DOMAIN`, `AUTH_URL`, the Caddy block).
6. Later: thumbnails while scrubbing, links to a moment (`?t=`), more courts.

## 11. Rules (the owner's, and lessons)

- Commit every turn with a `COMMIT_LOG.md` entry; **never push `padel-full`**.
  The public repo may be pushed (normal commits, never a force-push over
  commits you have not seen).
- Another session may commit in this workspace at the same time: `git add`
  explicit paths only; never stash, reset or `add -A` in `padel-full`.
- This PC shuts down when overloaded: keep it under 60 % CPU, one heavy job
  at a time.
- No passwords in git — the NVR, relay, publish and database passwords live
  only in `.env` / `relay.env` files and with the owner.
- North = channel 2, south = channel 8.
- Product framing: replay for disputes, never automatic line calling.
- `CLAUDE.md` "Lessons already paid for" lists the traps already hit (hls.js
  progressive mode, backward seeks, follower seek-chase, `play()` on an ended
  video, a playlist that never changes, module copies in `next dev`, …).

## 12. History in one screen

| date | |
|---|---|
| 2026-09-02 | scaffolded: MediaMTX + Next.js, simulator, replay of 40 s windows, live, clips, share links |
| 2026-09-03 | phone/tablet layout, login, AutoReload, `/api/health`; deployed on the shared VPS behind the host Caddy; public snapshot repo created; the club's answers (no static IP, Dahua NVR, AnyDesk PC) → relay on the club PC |
| 2026-09-04 | club visit: relay running and reboot-proof over the PC's Wi‑Fi; real network mapped; relay URL bug fixed; replay windows streamed via MSE |
| 2026-10-21 | the owner: rolling back "doesn't work, slow, laggy". Audit measured why; replay rebuilt as one HLS timeline over the recording files; 11 bugs found and fixed while driving it (COMMIT_LOG); exported and deployed |
| 2026-10-25 | this handover; docs brought up to date; `scripts/checks/` committed |
