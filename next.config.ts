import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image on the VPS runs the standalone server; video bytes are
  // proxied by route handlers on the Node runtime, never through a CDN.
  output: "standalone",
  // Pin the workspace root. The padel repo has other lockfiles higher up the
  // tree (a root package-lock.json, the labeling site), and Turbopack's
  // automatic root detection can pick an ancestor and break module
  // resolution. The labeling site hit exactly that.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
