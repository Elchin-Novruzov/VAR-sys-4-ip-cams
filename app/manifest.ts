import type { MetadataRoute } from "next";

/** Web app manifest, so Android and desktop Chrome can install the site as a
 *  standalone app on the courtside tablet. Served publicly (see proxy.ts). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Padel VAR",
    short_name: "VAR",
    description: "Court replay: rewind, slow motion, zoom, save the moment.",
    start_url: "/courts",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0f14",
    theme_color: "#0b0f14",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
