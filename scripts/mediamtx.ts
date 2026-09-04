/**
 * Download (once) and run the MediaMTX media server locally with
 * infra/mediamtx.yml, for development and simulator demos.
 *
 *   pnpm mediamtx
 *
 * Recordings land in ./recordings (gitignored). The same config runs in
 * Docker on the VPS; see docs/DEPLOY.md.
 */
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const VERSION = "v1.20.1";
const DIR = path.resolve(".mediamtx");
const EXE = path.join(DIR, process.platform === "win32" ? "mediamtx.exe" : "mediamtx");
const CONFIG = path.resolve("infra/mediamtx.yml");

async function download() {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const ext = os === "windows" ? "zip" : "tar.gz";
  const name = `mediamtx_${VERSION}_${os}_${arch}.${ext}`;
  const url = `https://github.com/bluenviron/mediamtx/releases/download/${VERSION}/${name}`;
  mkdirSync(DIR, { recursive: true });
  const archive = path.join(DIR, name);
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archive));
  if (ext === "zip") {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${archive}' -DestinationPath '${DIR}' -Force`,
    ]);
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", DIR]);
  }
  console.log(`installed to ${DIR}`);
}

async function main() {
  if (!existsSync(EXE)) await download();
  if (!existsSync(CONFIG)) throw new Error(`missing ${CONFIG}`);
  console.log(`starting MediaMTX ${VERSION} with ${path.relative(process.cwd(), CONFIG)}`);
  console.log("  RTMP publish  rtmp://127.0.0.1:1935/<path>?user=cam&pass=changeme");
  console.log("  HLS           http://127.0.0.1:8888/<path>/index.m3u8");
  console.log("  playback API  http://127.0.0.1:9996/list?path=<path>");
  const child = spawn(EXE, [CONFIG], { stdio: "inherit", cwd: process.cwd(), env: process.env });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
