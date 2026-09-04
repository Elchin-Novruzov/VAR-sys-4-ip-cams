# Padel VAR: plan

Written 2026-09-02. The in/out CV system missed its deadlines; this is the
product that buys time with stakeholders and is useful on its own. It reuses
the club's existing security cameras and needs no hardware at the court.

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
court cameras ──RTMP push──────►    MediaMTX  :1935 rtmp in                       browser / tablet
  (or a relay box, SRT)             ├ records fMP4, 1 s parts, 15 s segments,      over HTTPS
                                    │   deletes after 4 h                            live tiles
                                    ├ /list, /get   (playback by wall-clock time)    replay console
                                    └ HLS           (live)                            saved clips
                                    Next.js  (auth, UI, proxies; only it talks to MediaMTX)
                                    Caddy    (HTTPS for the domain)
                                    MongoDB (users, saved clips)
```

- Only 80/443, 1935 and 8890/udp are open on the VPS. HLS, playback and the
  control API are internal; every browser request for video goes through a
  Next.js route handler that checks the session and the camera path.
- Cameras publish with a user/password in the RTMP URL; the password is set
  from `.env` (`PUBLISH_PASS`).
- Replay = the page fetches "camera X from T for N seconds" as one MP4 per
  camera and plays from memory. All seeking and slow motion is local; the two
  cameras are locked to the first one's clock.
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
| club upload needed | about 8 Mbps sustained, two 1080p cameras at 4 Mbps |
| disk for 4 h of two cameras | about 14 GB |
| moment becomes replayable after | 1 to 2 s (one recording part) |
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
