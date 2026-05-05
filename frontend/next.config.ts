import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Don't generate a SW in dev — Serwist needs webpack and Next.js 16 defaults
  // to Turbopack in `next dev`. Production runs `next build --webpack` which
  // does produce `public/sw.js`. Track Turbopack support:
  // https://github.com/serwist/serwist/issues/54
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "flagcdn.com" }],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
};

export default withSerwist(nextConfig);
