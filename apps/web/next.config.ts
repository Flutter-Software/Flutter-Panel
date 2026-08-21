import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(configDir, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@flutter-software/shared"],
  outputFileTracingRoot: repoRoot,
  experimental: {
    middlewareClientMaxBodySize: "75mb",
    optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
  },
  turbopack: {
    root: repoRoot,
  },
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
