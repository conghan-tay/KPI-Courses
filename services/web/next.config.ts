import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside a polyglot repo (Go gateway, Python worker), so pin
  // the bundler root here rather than letting it walk up the tree and pick up a
  // stray lockfile above the repository.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  // The container image builds a self-contained server bundle; a local
  // `next build && next start` does not, because the two are incompatible and
  // the local path is the one people use every day.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
