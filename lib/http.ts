import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/** Serve a local file with HTTP Range support, so a `<video>` element can
 *  seek inside a saved clip without downloading it whole. */
export async function serveFile(
  req: Request,
  absPath: string,
  contentType = "video/mp4",
  downloadName?: string,
): Promise<Response> {
  let size: number;
  try {
    size = (await stat(absPath)).size;
  } catch {
    return new Response("not found", { status: 404 });
  }

  const base: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (downloadName) base["Content-Disposition"] = `inline; filename="${downloadName}"`;

  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m) {
    let start: number;
    let end: number;
    if (m[1] === "") {
      // suffix range: last N bytes
      const n = Number(m[2]);
      start = Math.max(0, size - n);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = createReadStream(absPath, { start, end });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = createReadStream(absPath);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...base, "Content-Length": String(size) },
  });
}
