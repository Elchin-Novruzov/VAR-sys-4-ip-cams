# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Court replay for a padel club on its existing security cameras: both ends of
the court on one clock, rewind, scrub, slow motion, frame step, pinch zoom,
"save this moment" with a public share link. Phones and tablets are the
primary devices — every change must hold up at phone and tablet sizes.

Where the story lives: [PLAN.md](PLAN.md) (product decisions, architecture,
phases), [README.md](README.md) (local run), [COMMIT_LOG.md](COMMIT_LOG.md)
(newest-first history of what changed and why — **read the top few entries
first**, and add an entry with every commit), [docs/DEPLOY.md](docs/DEPLOY.md)
and [docs/CAMERA_SETUP.md](docs/CAMERA_SETUP.md) (the path to production).

Status 2026-09-04: **deployed and live at https://72-62-236-90.sslip.io**
on the shared VPS (see `docs/DEPLOY.md`, "Existing reverse proxy on the host");
both simulator cameras verified recording end to end. The club's NVR is not on
the club network yet; the rack session that fixes that and starts the relay is
scripted step by step in `docs/CLUB_VISIT_2026-09-04.md`.

## If this is the public clone

This folder may be the public snapshot
(github.com/Elchin-Novruzov/VAR-sys-4-ip-cams, a one-commit history exported
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

MediaMTX receives RTMP from the cameras, records a rolling fMP4 buffer
(1 s parts, 15 s segments, deleted after 4 h), and answers time-range
requests. **Next.js is the only thing that talks to it**: every video byte
goes through a route handler that checks the session and that the camera path
exists in `config/courts.json`. Replay streams one fMP4 per camera for a
time window into a Media Source Extensions buffer while it downloads
(`lib/window-loader.ts`, `lib/mp4-stream.ts`; blob fallback without MSE) —
seeking, frame stepping and slow motion are all local; cameras sync to the
first camera's clock. Saving a clip cuts MP4s to `clips/<id>/` on disk plus
a Mongo doc with a share token.

Invariants that span files:

- Camera paths in `config/courts.json` must match `paths:` in
  `infra/mediamtx.yml`; `retentionHours` must match `recordDeleteAfter`.
- `proxy.ts` is the auth middleware; anything reachable logged-out must be in
  its `PUBLIC_PREFIXES` (login, share pages, shared-clip files,
  `/api/version`, manifest).
- `/api/version` + `AutoReload` (root layout) make long-lived courtside pages
  reload themselves on a new build. Keep the version route public and
  `no-store`.
- Touch sizing lives in `app/globals.css` (44 px controls, 40 px under
  640 px); short-landscape phones hide the header via the `.app-header` /
  `.auto-scrub` media query. New controls inherit this — don't hardcode
  heights.

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
- A replay window is 20 MB per camera (40 s at 4 Mbps). Never go back to
  `res.blob()` for it: waiting for the whole file looked like a frozen page
  at the club. Stream it (MSE), show progress per tile, abort on a new pick.
  The recorder itself answers in milliseconds — measure before blaming it.

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

## Conventions

Commit every turn, never push. Every commit gets a newest-first entry in
[COMMIT_LOG.md](COMMIT_LOG.md) saying what changed, why, and how it was
verified.
