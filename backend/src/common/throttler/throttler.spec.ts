import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.service.js';
import type { Redis } from 'ioredis';

/**
 * Integration test for the Redis-backed throttler. The global default
 * is bypassed for the rest of the suite via `THROTTLER_BYPASS_TEST=1`
 * (see `jest.setup.js`); this spec turns the bypass off temporarily so
 * the real `ThrottlerGuard` runs against Redis.
 *
 * The login limiter is configured for 5 requests per 60s keyed by
 * `${ip}:${dni}` — the 6th request from the same IP+DNI should get a
 * 429 regardless of the credentials supplied (the limiter runs before
 * password verification).
 */
describe('AppThrottlerModule (integration)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    process.env.THROTTLER_BYPASS_TEST = '0';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    redis = app.get<Redis>(REDIS_CLIENT);
  }, 30_000);

  afterAll(async () => {
    process.env.THROTTLER_BYPASS_TEST = '1';
    if (app) await app.close();
  });

  beforeEach(async () => {
    // `@nest-lab/throttler-storage-redis` uses keys shaped like
    // `{<hash>:<throttlerName>}:hits` / `:blocked`. Wipe both so this
    // spec is independent of previous runs (the block TTL is 1h for
    // some named throttlers — keys would otherwise survive between
    // test invocations on the dev Redis). Use SCAN-based iteration
    // since the curly braces in the key are awkward for glob matchers.
    const stream = redis.scanStream({ match: '*hits*', count: 200 });
    const hits: string[] = [];
    for await (const batch of stream) hits.push(...(batch as string[]));
    const stream2 = redis.scanStream({ match: '*blocked*', count: 200 });
    const blocked: string[] = [];
    for await (const batch of stream2) blocked.push(...(batch as string[]));
    const keys = [...hits, ...blocked];
    if (keys.length > 0) await redis.del(...keys);
  });

  it('returns 429 on the 6th login attempt within 60s', async () => {
    const dni = '11223344'; // unknown DNI: every request returns 401
    const fire = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ dni, password: 'irrelevant' });

    // 5 attempts: each rejected with 401 by AuthService, but throttler
    // still sees them (it runs before the controller).
    for (let i = 0; i < 5; i++) {
      const res = await fire();
      // 401 from AuthService — the limiter passes (1..5 hits ≤ 5).
      expect(res.status).toBe(401);
    }

    const sixth = await fire();
    expect(sixth.status).toBe(429);
  }, 30_000);

  it('isolates the login limiter per DNI: 5 attempts on each of two DNIs from the same IP both pass', async () => {
    // Tracker es `${ip}:${dni}` — atacar 5 veces el DNI A y 5 veces el
    // DNI B desde la misma IP debería caer en *dos* buckets separados,
    // ninguno superando el límite de 5/60s.
    const dniA = '22334455';
    const dniB = '33445566';
    const fire = (dni: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ dni, password: 'irrelevant' });

    for (let i = 0; i < 5; i++) {
      const res = await fire(dniA);
      expect(res.status).toBe(401);
    }
    for (let i = 0; i < 5; i++) {
      const res = await fire(dniB);
      // Si el tracker fuera solo IP, el primer hit acá ya vendría 429.
      expect(res.status).toBe(401);
    }
  }, 30_000);

  it('does NOT throttle the webhook (SkipThrottle)', async () => {
    // 10 webhook hits in a row should never 429. They will fail signature
    // verification (401), but that's the controller's domain, not the
    // limiter's. We assert that none of them comes back as 429.
    const headers = {
      'x-signature': 'ts=0,v1=invalid',
      'x-request-id': 'test-request-id',
    };
    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer())
        .post('/payments/webhook')
        .set(headers)
        .send({ type: 'payment', data: { id: '1' } });
      expect(res.status).not.toBe(429);
    }
  }, 30_000);
});
