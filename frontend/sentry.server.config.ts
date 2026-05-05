// Sentry server-side init. Loaded by `instrumentation.ts` when running in
// the Node.js runtime. No-op if NEXT_PUBLIC_SENTRY_DSN is unset so dev/test
// environments don't crash.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
