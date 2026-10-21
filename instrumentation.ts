/** Runs once when the server starts. Builds the replay index of every camera
 *  (lib/recordings.ts) so the first person to open a replay page does not
 *  wait for four hours of recordings to be read. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getCourts }, { replayIndex }] = await Promise.all([import("./lib/courts"), import("./lib/recordings")]);
  try {
    const t0 = Date.now();
    const courts = await getCourts();
    const cams = courts.flatMap((c) => c.cameras.map((cam) => cam.path));
    const counts = await Promise.all(cams.map(async (p) => (await replayIndex(p, 0)).chunks.length));
    console.log(`[replay] index ready in ${Date.now() - t0} ms: ${cams.map((p, i) => `${p} ${counts[i]} segments`).join(", ")}`);
  } catch (e) {
    console.error("[replay] index warm-up failed:", e);
  }
}
