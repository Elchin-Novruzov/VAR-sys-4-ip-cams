# Padel VAR

Court replay for padel clubs on the cameras they already have. Both ends of
the court on one clock; rewind, scrub, slow motion, frame step, pinch zoom,
and "save this moment" with a share link. Nothing at the club talks to anyone's
PC: the cameras push their stream to a cloud server, and the site is opened
from anywhere.

Plan and decisions: [PLAN.md](PLAN.md). Camera onboarding:
[docs/CAMERA_SETUP.md](docs/CAMERA_SETUP.md). Server: [docs/DEPLOY.md](docs/DEPLOY.md).

## Run it on a laptop with fake cameras

Needs Node 22+, pnpm, and ffmpeg on PATH. **Windows, once:** PowerShell blocks
pnpm's launcher script by default, so run this one time in any PowerShell
window (no admin needed): `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
Alternatively call `pnpm.cmd` instead of `pnpm`.

First, in this folder:

```bash
pnpm install
cp .env.example .env.local        # defaults already point at the local media server
```

Then **three separate terminals**, one command each; every one keeps running:

```bash
pnpm mediamtx                     # terminal 1: media server (downloads the binary once)
pnpm sim                          # terminal 2: two part4 court recordings become "cameras"
pnpm dev                          # terminal 3: the site
```

Open http://localhost:3000 and sign in with `dev@local` / `dev` (the dev login
in `.env.local`; it is ignored in production builds). After about fifteen
seconds the recorder has enough to replay.

**From a phone or tablet on the same Wi-Fi:** start the site with
`pnpm dev:lan` instead of `pnpm dev` and open `http://<this PC's IP>:3000`
(`ipconfig` shows it). On an iPad or iPhone, Share → "Add to Home Screen" opens
it full screen; on Android, Chrome offers "Install app".

Saved clips need a database: set `MONGODB_URI` in `.env.local`
and create a real login with

```bash
pnpm seed-user you@club.com "Your Name" a-strong-password admin
```

## Working from the public clone (a Mac at the club)

`git clone https://github.com/Elchin-Novruzov/VAR-sys-4-ip-cams.git` gives the
whole app with a one-commit history; the story is in `COMMIT_LOG.md` and
`docs/`. On a Mac: `brew install node pnpm ffmpeg` (Node 22+), then the steps
above. Four differences from the main workspace:

- **`pnpm sim` defaults to two recordings that live outside this repo.** Point
  it at any two videos of your own:
  `SIM_SOURCES="court1-north=/path/a.mp4;court1-south=/path/b.mp4" pnpm sim`
  — or skip the sim once the club relay pushes real cameras; those show on the
  production site, while local dev talks only to your local media server.
- **`.env.local` is not in the repo.** `cp .env.example .env.local` is enough
  for local work with the dev login. Only saving clips needs a `MONGODB_URI`;
  the production values live in the VPS `.env` and in Vercel, never in a
  commit.
- **Committing here and pushing to this repo is fine.** Say so afterwards: the
  main workspace (the private `padel-full` repo) merges your commits before
  its next snapshot. Snapshots are force-pushed, so an unmerged commit here
  would be overwritten — that is the only rule.
- **Claude Code on the Mac:** `npm install -g @anthropic-ai/claude-code`, then
  `claude` inside the clone. It reads `CLAUDE.md`; it has none of the Windows
  sessions' memory, so `COMMIT_LOG.md` (newest first) is the memory.

## Layout

```
app/            Next.js App Router: login, courts, replay, live, clips, share
  api/video/    proxies to the media server (segments, time-range get, HLS)
  api/clips/    save / list / serve clips
components/     replay console, zoom-pan, timeline, live grid, clip players
lib/            media server client, courts config, clips, Mongo, helpers
config/         courts.json: which courts and camera paths exist
infra/          mediamtx.yml, docker-compose.yml, Caddyfile, env.example
scripts/        mediamtx (local server), sim (fake cameras), seed-user
```

## How replay works

The media server records every camera into one-second fragments inside
fifteen-second segments and deletes them after the retention window. The
site asks it for "camera X from time T for N seconds", gets a browser-playable
MP4, and plays it from memory. Seeking, frame stepping and slow motion are
therefore instant, and both cameras are kept on the same timeline by the page.
