/**
 * Fake cameras: loop two real court recordings into the media server as if
 * they were the club's cameras, re-encoded the way a security camera would
 * stream (H.264, 25 fps, 4 Mbps CBR, 1 s GOP) with the wall clock burned in.
 *
 *   pnpm sim
 *
 * Environment:
 *   SIM_RTMP_HOST  where MediaMTX listens (default 127.0.0.1)
 *   PUBLISH_PASS   the `cam` user's password in infra/mediamtx.yml (default changeme)
 *   SIM_SOURCES    "court1-north=path/to/a.mp4;court1-south=path/to/b.mp4"
 *                  (default: two part4 clips from the in/out project)
 *   SIM_FPS        output frame rate (default 25)
 *   SIM_CLOCK=0    disable the burned-in clock (needs drawtext support in ffmpeg)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const HOST = process.env.SIM_RTMP_HOST ?? "127.0.0.1";
const PASS = process.env.PUBLISH_PASS ?? "changeme";
const FPS = Number(process.env.SIM_FPS ?? 25);
const CLOCK = process.env.SIM_CLOCK !== "0";

const DEFAULTS = [
  ["court1-north", "../padel_analytics/inout/part4/ov9281_20260813_213620.mp4"],
  ["court1-south", "../padel_analytics/inout/part4/ov9281_20260813_212716.mp4"],
] as const;

function sources(): [string, string][] {
  const env = process.env.SIM_SOURCES;
  if (!env) return DEFAULTS.map(([p, f]) => [p, path.resolve(f)]);
  return env.split(";").map((pair) => {
    const [p, f] = pair.split("=");
    return [p.trim(), path.resolve(f.trim())];
  });
}

/** A TrueType font for the burned-in clock. Fontconfig is not available in
 *  every ffmpeg build (the Windows builds crash without it), so the file is
 *  named explicitly. Returns null if nothing usable is found. */
function fontFile(): string | null {
  const candidates =
    process.platform === "win32"
      ? ["C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf"]
      : process.platform === "darwin"
        ? ["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"]
        : ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"];
  return candidates.find((f) => existsSync(f)) ?? null;
}

/** Quote an ffmpeg filter option value. ffmpeg unescapes once when parsing
 *  the graph and once more when parsing the filter's options, so a bare `\:`
 *  is consumed too early; a single-quoted token passes through the first
 *  layer literally and the option layer then turns `\:` into `:`. Verified
 *  on ffmpeg 8.1 with the two forms this script needs (fontfile with a
 *  drive letter, and %{localtime:...}). ffmpeg is spawned without a shell. */
function q(v: string) {
  return "'" + v.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'") + "'";
}

function run(streamPath: string, file: string) {
  const label = streamPath.replace(/-/g, " ");
  const filters = [`fps=${FPS}`];
  const font = CLOCK ? fontFile() : null;
  if (CLOCK && !font) console.warn(`[${streamPath}] no font file found, clock overlay disabled`);
  if (font) {
    // %{localtime:%X} expands to the local time; the colon between function
    // and argument must survive the filter-graph parser, hence esc().
    filters.push(
      `drawtext=fontfile=${q(font)}:text=${q(`%{localtime:%X}  ${label}`)}` +
        `:x=20:y=20:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8`,
    );
  }
  const url = `rtmp://${HOST}:1935/${streamPath}?user=cam&pass=${PASS}`;
  const args = [
    "-hide_banner", "-loglevel", "warning",
    "-re", "-stream_loop", "-1", "-i", file,
    "-an",
    "-vf", filters.join(","),
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
    "-b:v", "4M", "-maxrate", "4M", "-bufsize", "8M",
    "-g", String(FPS), "-keyint_min", String(FPS), "-sc_threshold", "0",
    "-f", "flv", url,
  ];
  console.log(`[${streamPath}] ${path.basename(file)} -> ${url.replace(PASS, "***")}`);
  const child = spawn("ffmpeg", args, { stdio: "inherit" });
  child.on("exit", (code) => {
    console.log(`[${streamPath}] ffmpeg exited (${code}); restarting in 2 s`);
    setTimeout(() => run(streamPath, file), 2000);
  });
  return child;
}

for (const [p, f] of sources()) {
  if (!existsSync(f)) {
    console.error(`[${p}] source not found: ${f}`);
    process.exit(1);
  }
  run(p, f);
}
