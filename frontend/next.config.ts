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
  /* config options here */
};

export default withSerwist(nextConfig);
