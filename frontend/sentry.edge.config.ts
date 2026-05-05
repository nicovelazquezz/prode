// Sentry edge runtime init. Loaded by `instrumentation.ts` when running on
// the edge runtime (e.g. middleware, edge route handlers). No-op if
// NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
