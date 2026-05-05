// Next.js instrumentation hook. Sentry v10 reads this file (or
// src/instrumentation.ts) to decide what to load on the server and edge
// runtimes. The client-side init lives in sentry.client.config.ts and is
// injected by @sentry/nextjs's webpack plugin.
//
// NEXT_RUNTIME is set by Next.js itself: "nodejs" | "edge".
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown inside server components / route handlers so Sentry
// can correlate them with the active span. No-op if Sentry isn't initialized.
export const onRequestError = Sentry.captureRequestError;
