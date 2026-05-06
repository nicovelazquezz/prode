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

// Build the Content-Security-Policy as a single string. Notes:
//   - 'unsafe-inline' on style-src is required because Next/Tailwind injects
//     small inline <style> blocks during SSR hydration.
//   - 'unsafe-eval' on script-src is only needed in dev (Turbopack/Webpack
//     HMR). In prod we keep it off.
//   - frame-src includes mercadopago.com so the MP Bricks/Checkout Pro iframe
//     can load. img-src + connect-src include flagcdn (banderas) and the
//     backend API URL, which can be set via NEXT_PUBLIC_API_URL.
const isProd = process.env.NODE_ENV === "production";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
// connect-src needs the backend's HTTPS (or HTTP in dev) origin so fetches
// from the browser aren't blocked. Falls back to "*" in dev if unset.
const apiConnectSrc =
  apiUrl ||
  (isProd ? "https:" : "http://localhost:* http://127.0.0.1:* ws://localhost:*");

const cspParts: string[] = [
  "default-src 'self'",
  // 'unsafe-eval' only in dev for HMR; prod is strict 'self'.
  `script-src 'self' 'unsafe-inline' ${isProd ? "" : "'unsafe-eval'"} https://sdk.mercadopago.com https://www.mercadopago.com`.trim(),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // flagcdn for country flags, MP for any icon/image they hand back, blob/data
  // for the SW + dynamic icon usage.
  "img-src 'self' data: blob: https://flagcdn.com https://static.flashscore.com https://*.mlstatic.com https://*.mercadopago.com",
  // MercadoPago Checkout Pro / Brick iframe.
  "frame-src 'self' https://*.mercadopago.com https://*.mercadolibre.com",
  `connect-src 'self' ${apiConnectSrc} https://*.sentry.io https://*.ingest.sentry.io https://api.mercadopago.com`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
];
if (isProd) cspParts.push("upgrade-insecure-requests");

const contentSecurityPolicy = cspParts.join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down high-risk APIs we don't use. Keep it short and explicit.
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(self), usb=()",
  },
  // Force HTTPS once we're on HTTPS. Browsers ignore this on HTTP origins,
  // so it's safe to keep on always.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "flagcdn.com" },
      { protocol: "https", hostname: "static.flashscore.com" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  async headers() {
    return [
      {
        // Apply to every route — Next handles overrides per-route via the
        // `matchers` if needed.
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Service worker MUST be served as JS with no caching so updates land
        // immediately for users who already installed the PWA.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
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
