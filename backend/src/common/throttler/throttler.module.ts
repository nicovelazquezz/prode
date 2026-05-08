import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerModule,
  ThrottlerGuard,
  seconds,
} from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.service.js';

/**
 * Named throttlers (spec 8.3):
 *   - default        100 req / 60s   per IP   (every endpoint not opted out)
 *   - login          5 / 60s         per IP+DNI (DNI keying via per-route getTracker)
 *   - auth-recovery  3 / 1h          per IP   (forgot-password, complete-registration)
 *   - payments-init  5 / 1h          per IP
 *
 * Storage is shared Redis (via `REDIS_CLIENT`) so the limits hold across
 * multiple Node processes / containers. The webhook endpoint
 * (`POST /payments/webhook`) opts out via `@SkipThrottle({...})`.
 *
 * The `@nestjs/throttler` v6 guard applies *every* named throttler to
 * *every* request. Without per-throttler `skipIf` predicates, the
 * `auth-recovery` limiter (3 req / 1h) would also fire on `/auth/login`
 * and lock out a real user after three login attempts. We therefore
 * scope each named throttler to its target endpoint(s) by URL prefix.
 * The endpoint `@Throttle({ name: { limit, ttl } })` decorator then
 * tunes / opts-in the relevant throttler.
 *
 * Throttling is bypassed when `THROTTLER_BYPASS_TEST=1` so the
 * integration suite can fire many requests against a fresh app without
 * tripping limits. The dedicated throttler test (`throttler.spec.ts`)
 * flips the env var off per-suite to exercise the real guard.
 */
function isPath(ctx: ExecutionContext, path: string): boolean {
  const req = ctx.switchToHttp().getRequest<Request>();
  // `req.path` excludes the query-string and is normalised by Express.
  return req?.path === path;
}

function isAnyPath(ctx: ExecutionContext, ...paths: string[]): boolean {
  return paths.some((p) => isPath(ctx, p));
}

const isTestBypass = (): boolean => process.env.THROTTLER_BYPASS_TEST === '1';

/**
 * Tracker para `/auth/login`: combina IP con DNI. Sin DNI, IPs distintas
 * de un atacante (botnet, residential proxies) podrían probar 5 logins
 * c/u contra el mismo DNI sin disparar el límite global.
 *
 * El body de la request es leído por el body-parser de Nest *antes* de
 * que el guard corra, así que `req.body.dni` está disponible. Si por
 * alguna razón el DNI no llegó (curl con body mal formado), caemos a
 * solo IP — peor estrategia que perder el chequeo entero.
 */
function loginTracker(
  req: Record<string, unknown>,
): string {
  const ip = typeof req.ip === 'string' ? req.ip : 'unknown-ip';
  const body = req.body as { dni?: unknown } | undefined;
  const rawDni = body?.dni;
  const dni =
    typeof rawDni === 'string' && rawDni.length > 0 ? rawDni.trim() : '';
  return dni ? `${ip}:${dni}` : ip;
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        storage: new ThrottlerStorageRedisService(redis),
        // Common skipIf is used by named throttlers that don't define
        // their own; below we override per-throttler with predicates that
        // also honour the test bypass.
        skipIf: () => isTestBypass(),
        throttlers: [
          { name: 'default', limit: 100, ttl: seconds(60) },
          {
            name: 'login',
            limit: 5,
            ttl: seconds(60),
            // Either the test suite asked us to step out of the way, or
            // this isn't the login route. Per-throttler skipIf REPLACES
            // the common one, so we must re-check the bypass here.
            skipIf: (ctx) => isTestBypass() || !isPath(ctx, '/auth/login'),
            // Track por IP+DNI: un atacante con muchas IPs no puede
            // brute-force el mismo DNI esquivando el límite global por
            // IP. Cuando no hay DNI parseable, cae a solo IP.
            getTracker: (req) => loginTracker(req),
          },
          {
            name: 'auth-recovery',
            limit: 3,
            ttl: seconds(60 * 60),
            skipIf: (ctx) =>
              isTestBypass() ||
              !isAnyPath(
                ctx,
                '/auth/forgot-password',
                '/auth/complete-registration',
              ),
          },
          {
            name: 'payments-init',
            limit: 5,
            ttl: seconds(60 * 60),
            skipIf: (ctx) =>
              isTestBypass() || !isPath(ctx, '/payments/init'),
          },
        ],
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppThrottlerModule {}
