import type { MetadataRoute } from "next";

/** Web app manifest, so Android and desktop Chrome can install the site as a
 *  standalone app on the courtside tablet. Served publicly (see proxy.ts). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Padel Center Baku · VAR Replay",
    short_name: "PCB VAR",
    description: "Padel Center Baku court replay: rewind, slow motion, zoom, save the moment.",
    start_url: "/courts",
    display: "standalone",
    orientation: "any",
    background_color: "#080908",
    theme_color: "#080908",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // the ball sits inside the 80 % safe zone, so the same file masks well
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
