import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs";

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

const sentryWrappedConfig = withSentryConfig(withSerwist(nextConfig), {
  // Don't print Sentry SDK version mismatch warnings to keep `next build`
  // output clean. Re-enable if you want to debug Sentry telemetry.
  silent: !process.env.CI,
  // Skip the source map upload step entirely when no auth token is set
  // (CI/dev). Avoids the "skipping source map upload" warning per build.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // No-op when DSN unset — see sentry.*.config.ts files.
});

export default sentryWrappedConfig;
