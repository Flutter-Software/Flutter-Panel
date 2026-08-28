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
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // File uploads POST JSON through this Next process (rewritten to the API).
    middlewareClientMaxBodySize: "400mb",
    optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
  },
  turbopack: {
    root: repoRoot,
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Browser never talks to :4000 for HTTP. WS is a special case — see
    // browserConsoleSocketUrl. nginx in prod does the same /api → api split.
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
