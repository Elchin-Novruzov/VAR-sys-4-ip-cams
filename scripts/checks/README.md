# Browser checks for replay

There is no test suite; replay is verified by driving the real page in
headless Chrome. These are the tools behind the 2026-10-21 numbers in
`COMMIT_LOG.md`.

| file | what |
|---|---|
| `replay-audit.mjs` | the phone audit: open, far tap, drag back at 1m zoom, −10 ×3, frame steps on both cameras, 10 s of play, slow motion, ⟲ 10s, −1s inside played video, heap, layout. Prints one line per step with OK/FAIL; exit code 1 on any FAIL. |
| `mint-session.mjs` | a session cookie for a local **production** build (no dev login there). |
| `responsive-audit.mjs` | (2026-10-28) every page on 18 phone and iPad profiles (Playwright's device list: iPhone SE / SE3 / 13 / 15 Pro Max, Galaxy S8, Pixel 7, upright and on their side; iPad mini, Air, Pro 11, Pro 12.9 both ways). Flags sideways scroll, content cut off by its own box, the replay console taller than the screen, the save sheet off screen; notes tap targets under 32 px and items behind a sideways scroll. `DEVICES=iPhone,iPad PAGES=replay` narrow it, `SHOTS=0` skips screenshots, `OUT` is where they go. |
| `review-check.mjs` | (2026-10-28) the VAR review on the replay page: `?back=20`, M, R (prints the clock going forward to +1 s and back to −2 s around the mark), Escape, O (the loop wraps), S with a tag. The save POST is answered in the browser, so nothing is cut or stored. `VIEW=390x844` etc. |
| `live-sync-check.mjs` | (2026-10-28) live sync on the live page: the spread between the tiles at rest, after one tile is knocked 1 s back, and 3.5 s back. Needs a MediaMTX with two cameras publishing — see "Live tests" below. |

## Running the audit

1. A site with **at least two hours** of recording for the court (the far tap
   goes 1.5 h back; `BACK_HOURS` changes that). Locally that means a
   recordings folder with long footage — see "Test recordings" below.
2. `playwright-core` in some scratch folder (it is not a dependency of the
   app; the script resolves it from the current folder):

   ```
   mkdir %TEMP%\pw && cd %TEMP%\pw && npm i playwright-core
   node C:\Users\Admin\Desktop\padel\var-replay\scripts\checks\replay-audit.mjs
   ```

   It drives the installed Chrome (`channel: "chrome"`), nothing to download.
3. Knobs: `BASE`, `SESSION`, `COURT`, `MBPS` (10 = phone on 4G, the hard
   case; 20 = typical Wi‑Fi), `VIEW` (`390x844` phone, `844x390`,
   `820x1180`, `1180x820`), `BACK_HOURS`, `SHOT`.

Expected on the 4.4 h test recording (2026-10-21, 10 Mbps phone): open ≈ 2.4 s,
far tap ≈ 1 s / 1 MB, drag back ≈ 2.2 s from drag start, each −10 ≈ 1 s,
follower on the leader's frame within ~1.5 s, frame steps < 250 ms and exactly
−40 ms on both cameras, no follower seeks during 10 s of play, ⟲ 10s ≈ 1 s,
−1s inside played video < 150 ms, playlist traffic < 100 KB. At 20 Mbps
roughly half the times.

The page exposes its players as `window.__replay` in development builds, and
with `?debug` in the URL on any build: `wallNow()`, `frameTime` (the frame
on screen), `buffered()`, `isLoading()`, `liveEdge()`.

## Production build

```
pnpm build
# copy what the Dockerfile copies
cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
cd .next/standalone
PORT=3001 HOSTNAME=127.0.0.1 AUTH_SECRET=<from .env.local> AUTH_URL=http://localhost:3001 \
  RECORDINGS_DIR=C:/Users/Admin/Desktop/padel/var-replay/recordings \
  COURTS_FILE=C:/Users/Admin/Desktop/padel/var-replay/config/courts.json node server.js
```

Then `AUTH_SECRET=<same> node scripts/checks/mint-session.mjs > session.txt`
(run from `var-replay/`, it imports `next-auth`), and the audit with
`BASE=http://127.0.0.1:3001 SESSION=<contents>`. Startup prints
`[replay] index ready in … ms` (instrumentation.ts). On this PC (16 threads;
keep it under 60 % CPU) the build was pinned to 6 cores at low priority:
`start "" /wait /low /affinity 3F cmd /c pnpm build`.

## Test recordings — do not lose them

`var-replay/recordings/court1-*/` on the dev PC holds 4.4 h of simulator
recording from 2026-09-03 (1 052 files per camera). It is the only long
buffer for testing. **`pnpm mediamtx` uses `infra/mediamtx.yml`, whose
`recordDeleteAfter: 4h` deletes it.** Instead:

- **Replay against old footage:** just `pnpm dev`; the site reads the files
  itself. Clips (which go through MediaMTX `/get`) need a MediaMTX that
  records nothing — a scratch config with `record: no`, `rtmp: no`,
  `playback: yes` on another port, pointed at by `MEDIAMTX_PLAYBACK_URL`.
- **A growing recording (live edge, cameras stopping and coming back):** a
  scratch MediaMTX config with RTMP on 127.0.0.1:1935, the `cam` publish user
  from `infra/mediamtx.yml`, `recordPath: <scratch folder>/%path/%Y-%m-%d_%H-%M-%S-%f`,
  the same part/segment durations; then `pnpm sim` and `pnpm dev` with
  `RECORDINGS_DIR=<scratch folder>`. Checks that passed on 2026-10-21: the
  bar's end grows ~1 s per second, playlist reloads are deltas only
  (`_HLS_skip=YES`, ~1 KB), ● Live plays without `waiting` events and the
  cameras stay within ~30 ms, ⟲ 10s at the edge < 200 ms, stopping the
  simulator closes both playlists (`#EXT-X-ENDLIST`, no reloads), restarting
  it brings the players back and a tap before the gap lands there.
  To stop only the simulator on Windows, stop the `node.exe` / `ffmpeg.exe`
  processes whose command line contains `scripts/sim.ts` or
  `rtmp://127.0.0.1:1935/court1` — and exclude your own PowerShell process,
  whose command line contains the same text.

## Live tests (live sync, a camera coming back)

Never run `pnpm mediamtx` here: it records into `./recordings` and deletes
the test footage after 4 h. Use a scratch config with recording off and the
record path in a temp folder:

```
sed -e 's/record: yes/record: no/' -e 's#recordPath: ./recordings/#recordPath: C:/Temp/mtx-scratch/#' infra/mediamtx.yml > %TEMP%/mtx.yml
.mediamtx/mediamtx.exe %TEMP%/mtx.yml
```

and publish looped recording files without re-encoding (a few % CPU):

```
ffmpeg -re -stream_loop -1 -i recordings/court1-north/<a file>.mp4 -an -c copy -f flv "rtmp://127.0.0.1:1935/court1-north?user=cam&pass=changeme"
```

(same for court1-south). Run each as its own background job and stop those
jobs afterwards, never every ffmpeg on the machine: the detector PC's own
capture runs ffmpeg too. Measured 2026-10-28: 15–20 ms apart at rest, a
tile 1 s off caught in ~4 s, 3.5 s off in one jump; a tile whose camera
starts later plays within ~14 s without a reload.
