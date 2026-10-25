# Padel VAR: plan

Written 2026-09-02. The in/out CV system missed its deadlines; this is the
product that buys time with stakeholders and is useful on its own. It reuses
the club's existing security cameras and needs no hardware at the court.

## Status 2026-10-25

| | |
|---|---|
| site | **live at https://72-62-236-90.sslip.io** since 2026-09-03 — shared VPS, host Caddy + `mediamtx` / `web` containers in `/root/padel-var` |
| cameras | both court cameras streaming since the 2026-09-04 club visit: a relay on the club PC (ffmpeg RTSP→RTMP, scheduled task, survives a cold reboot) over Wi-Fi; north = NVR ch2, south = ch8 |
| phases | 1 simulator ✔, 2 cloud ✔, 3 cameras ✔ (via the relay, not camera push — the cameras sit behind the NVR), 4 courtside: tablet not yet reported, 5 later |
| replay | one HLS timeline per camera over the whole 4 h buffer, served from the recording files (2026-10-21): drag anywhere, zoom the bar, roll back without reloading. Deployed (the server has the new `/api/health` field); on 2026-10-25 it listed no camera folders — most likely no streaming for 4 h; to confirm with the real cameras (HANDOVER.md §1, §8) |
| deploy | export a snapshot to the public repo (github.com/Elchin-Novruzov/VAR-sys-4-ip-cams), the user runs `git fetch` + `git reset --hard origin/main` / `compose up` on the VPS (docs/DEPLOY.md); no SSH key from the dev machine |
| open | confirm replay on the real cameras (and an iPhone); AutoReload never fires while a video plays (a courtside tablet keeps old code); "Both" view on weak phone lines (two 4 Mbps streams); club: ch8 shutter at the rack monitor, cable the PC off Wi-Fi (find the second router), upload speed test, photos, ch3, `padel-relay` task health and log size; the courtside tablet. Ordered list: HANDOVER.md §10 |

Decisions that were "undecided" on 2026-09-02 are settled: it runs on the VPS;
the cameras are Dahua behind an NVR (`docs/CAMERA_SETUP.md` §0 has the real
topology); the club needs the relay PC, not camera-side push.

## What it is

A replay tool for disputes in club play: both ends of the court on one clock,
rewind, scrub, slow motion, frame stepping, pinch zoom, save the moment, share
a link. It resolves double bounces, glass-first versus floor-first, balls a
metre out, and who touched what. It does **not** call close lines, and the
pitch must say so.

Why not: security cameras record at 15 to 30 fps. The in/out project measured
that at 120 fps the ball travels one diameter per frame; at 25 fps it travels
about five. Slow motion on that footage is frame stepping through 40 ms gaps,
and a bounce at the line usually falls between two frames. Automatic line
calling is the next phase, on the 120 fps rig.

## Decisions (2026-09-02)

| question | decision |
|---|---|
| anything at the club? | **no**: the cameras push RTMP to the cloud themselves |
| where does it run? | undecided; simulator first, then a VPS (Docker Compose, Caddy) |
| camera brand | unknown; onboarding doc covers Dahua and Hikvision |
| how far back | **4 hours** (`recordDeleteAfter: 4h`, `retentionHours: 4`) |
| database | **the labeling site's MongoDB server, in a new database `var-replay`** (user's call, 2026-09-03; it is on a public IP without TLS, and it has dropped connections before, so the driver keeps a small pool and short timeouts) |
| stack | Next.js 16, TypeScript, Tailwind 4, Auth.js, MongoDB driver, same as the labeling site |

## Architecture

```
CLUB (outbound only)                CLOUD VPS (docker compose)                  ANYWHERE
cameras → NVR → relay PC            MediaMTX  :1935 rtmp in                       browser / tablet
  (ffmpeg, RTMP push) ─────────►    ├ records fMP4 to a volume: 1 s parts,         over HTTPS
                                    │   15 s files, deleted after 4 h                live tiles
                                    ├ /get          (saving clips)                   replay console
                                    └ HLS           (live)                           saved clips
                                    Next.js  (auth, UI; reads the recording files
                                             read-only and serves replay as HLS)
                                    Caddy    (HTTPS; the host's own on this VPS)
                                    MongoDB (users, saved clips)
```

- Only 80/443, 1935 and 8890/udp are open on the VPS. HLS, playback and the
  control API are internal; every browser request for video goes through a
  Next.js route handler that checks the session and the camera path.
- Cameras publish with a user/password in the RTMP URL; the password is set
  from `.env` (`PUBLISH_PASS`).
- Replay (since 2026-10-21) = each camera's whole buffer as one live HLS
  playlist, built by the site from MediaMTX's recording files (~2 s
  keyframe-aligned segments, delta playlist updates). The page plays it with
  hls.js; only the segment at a target is downloaded, played video stays in
  the browser, and the second camera follows the first one's clock. Details:
  HANDOVER.md §4. (Until then: one 40 s MP4 window per camera at a time.)
- Time = server arrival time. Both cameras push from the same LAN, so they
  land within a few hundred milliseconds of each other, which is well inside
  what 25 fps footage can show.

## Phases

1. **Simulator** (now). Two part4 court recordings loop into the media server
   as fake cameras with the wall clock burned in. The whole product is
   demoable on a laptop and testable end to end.
2. **Cloud.** Rent a VPS and a domain, `docker compose up`, seed a
   login. Point the simulator at it from the office to prove the internet
   path before touching the club.
3. **Cameras.** One person at the club sets the two court cameras' encoding
   and RTMP push (docs/CAMERA_SETUP.md). If the cameras cannot push, a small
   relay box in the rack does it.
4. **Courtside.** A tablet on the court wall opens the replay page. Staff
   accounts; optional player accounts later.
5. **Later.** WebRTC for sub-second live, multi-court, per-court branding,
   clip export to social formats. And the "save this moment" clips are the
   disputed-call dataset the in/out project has never had.

## Numbers that size it

| item | figure |
|---|---|
| club upload needed | about 8 Mbps sustained, two cameras at 4 Mbps (set to 2560×1440, 25 fps, CBR 4096) |
| disk for 4 h of two cameras | about 14 GB |
| moment becomes replayable after | about 3 to 4 s (a 2 s segment is listed once the next keyframe is written) |
| viewer download | about 4 Mbps per camera while playing (two cameras ≈ 9 Mbps); ~1 MB per camera per jump |
| slow-motion floor in Chrome | 0.0625×; Safari may clamp lower speeds |
| VPS | 2 vCPU, 4 GB, 40 GB disk is plenty; 10 to 25 USD a month |

## What the client / user must do

1. Rent a VPS and a domain, or hand over access to one.
2. Database: done, the shared Mongo server with its own `var-replay` database.
3. Read the camera brand and model off the NVR's camera list; run a speed
   test at the club for the upload figure.
4. Have the installer set the two court cameras: H.264, max frame rate, CBR
   4 Mbps, 1 s I-frame interval, smart codec off, shutter 1/500 s or faster,
   then RTMP push to the server.
5. Put a tablet at the court.
