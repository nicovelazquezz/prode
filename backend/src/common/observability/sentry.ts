import * as Sentry from '@sentry/node';
import { Logger } from '@nestjs/common';
import type { Env } from '../../config/env.js';

const logger = new Logger('Sentry');
let initialized = false;

/**
 * Initialises Sentry once per process. No-op when:
 *   - `SENTRY_DSN` is not set (dev/test, or staging without an org yet)
 *   - already initialised (defensive — `main.ts` calls this once but
 *     hot-reload tooling can re-import the module)
 *
 * The capture path in `GlobalExceptionFilter` checks
 * `isSentryInitialized()` before invoking `captureException` so we
 * don't burn quota or warn on every 5xx in dev.
 */
export function initSentry(
  env: Pick<Env, 'NODE_ENV' | 'SENTRY_DSN'>,
): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) {
    logger.log('SENTRY_DSN not set — Sentry disabled');
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
  initialized = true;
  logger.log(`Sentry initialised (env=${env.NODE_ENV})`);
}

export function isSentryInitialized(): boolean {
  return initialized;
}

/** Test-only: reset state between specs. */
export function _resetSentryForTests(): void {
  initialized = false;
}

export { Sentry };
