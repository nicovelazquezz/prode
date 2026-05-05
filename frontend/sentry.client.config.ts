// Sentry client-side init.
//
// Loaded automatically by @sentry/nextjs when @sentry/nextjs config wrapping
// is in place (or via the Next.js webpack entry injection). If no
// NEXT_PUBLIC_SENTRY_DSN is configured, we skip Sentry.init() to avoid
// crashing dev/test environments.
//
// NOTE: Sentry v10 prefers `instrumentation-client.ts` over this file when
// using Turbopack, but Turbopack is disabled for production builds in this
// project (see next.config.ts notes about Serwist). This file works fine in
// webpack mode. TODO: when migrating away from Serwist's webpack dep, move
// this to `instrumentation-client.ts`.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // Only enable replay on errors to keep payload small.
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
  });
}
