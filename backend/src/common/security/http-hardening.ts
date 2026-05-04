import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Env } from '../../config/env.js';

/**
 * Applies the same helmet + CORS settings that `main.ts` does so the
 * integration suite (which builds the app via `Test.createTestingModule`
 * + `createNestApplication`) can exercise the production hardening.
 *
 * Kept as a small helper rather than a Nest middleware module so we
 * can apply it once before `app.init()` and avoid the order-of-imports
 * dance that comes with global middleware in Nest.
 */
export function applyHttpHardening(
  app: INestApplication,
  env: Pick<Env, 'FRONTEND_URL'>,
): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // Pass a function so the `Access-Control-Allow-Origin` header is only
  // ever set to `FRONTEND_URL` for matching origins. Passing the URL as
  // a plain string would emit it for *any* origin, defeating the
  // purpose of the allowlist.
  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      cb: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      // Same-origin / curl requests have no Origin header — let them
      // through (no CORS headers needed).
      if (!requestOrigin) return cb(null, true);
      if (requestOrigin === env.FRONTEND_URL) return cb(null, env.FRONTEND_URL);
      // Reject by emitting `false`; cors will simply omit the
      // `Access-Control-Allow-Origin` header so the browser blocks.
      return cb(null, false);
    },
    credentials: true,
  });
}
