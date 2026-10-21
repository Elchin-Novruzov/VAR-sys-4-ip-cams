import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

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

/** A text response, gzipped when the client accepts it and it is worth it.
 *  Used for HLS playlists: four hours of segments is ~400 KB of text that
 *  compresses about tenfold, and the host proxy does not compress
 *  application/vnd.apple.mpegurl by itself. */
export function textResponse(req: Request, body: string, contentType: string, status = 200): Response {
  const headers: Record<string, string> = { "Content-Type": contentType, "Cache-Control": "no-store", Vary: "Accept-Encoding" };
  const raw = Buffer.from(body, "utf8");
  if (raw.length > 2048 && /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
    const gz = gzipSync(raw, { level: 6 });
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = String(gz.length);
    return new Response(gz as unknown as BodyInit, { status, headers });
  }
  headers["Content-Length"] = String(raw.length);
  return new Response(raw as unknown as BodyInit, { status, headers });
}

/** Bytes that never change for a given URL (content-addressed or cut from a
 *  finished recording): the browser may keep them. */
export function immutableBytes(buf: Buffer, contentType: string): Response {
  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
