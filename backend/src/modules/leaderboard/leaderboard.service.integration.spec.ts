import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.service.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LeaderboardRepository } from './leaderboard.repository.js';

/**
 * Integration tests for the cached read path. Boots the full app so we
 * exercise the real Redis connection (matches production wiring) and
 * verifies:
 *   1. cache hits avoid the repo call
 *   2. invalidate() drops every leaderboard:* key
 *   3. getMyAround is NOT cached (per-user — would explode keyspace)
 */
describe('LeaderboardService (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: LeaderboardService;
  let repo: LeaderboardRepository;
  let redis: Redis;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(LeaderboardService);
    repo = app.get(LeaderboardRepository);
    redis = app.get(REDIS_CLIENT);

    // Clear any leftover cache keys from prior runs.
    const stale = await redis.keys('leaderboard:*');
    if (stale.length) await redis.del(...stale);

    // Refresh MV so we have at least the seeded ladder to read.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
  }, 60_000);

  afterAll(async () => {
    if (redis) {
      const keys = await redis.keys('leaderboard:*');
      if (keys.length) await redis.del(...keys);
    }
    if (app) await app.close();
  }, 30_000);

  it('getGlobal: caches the result and returns the cached payload on the second call', async () => {
    const spy = jest.spyOn(repo, 'getGlobal');
    spy.mockClear();

    const first = await service.getGlobal(1, 25);
    const second = await service.getGlobal(1, 25);

    expect(first).toEqual(second);
    expect(spy).toHaveBeenCalledTimes(1);

    // Verify the cache key actually landed in Redis with a TTL.
    const ttl = await redis.ttl('leaderboard:global:1:25');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    spy.mockRestore();
  });

  it('invalidate: drops every leaderboard:* key', async () => {
    // Prime three different shapes to make sure they all get cleared.
    await service.getGlobal(1, 25);
    await service.getByPhase('GROUPS', 1, 25);
    // League key only lands if the league exists; we just write a fake
    // entry so the assertion below doesn't depend on a league fixture.
    await redis.set('leaderboard:league:fake:1:25', '{}', 'EX', 60);

    const before = await redis.keys('leaderboard:*');
    expect(before.length).toBeGreaterThanOrEqual(2);

    await service.invalidate();

    const after = await redis.keys('leaderboard:*');
    expect(after).toHaveLength(0);
  });

  it('getEntryAround: bypasses cache (per-entry — never persisted)', async () => {
    // Pick any seeded entry so the query has a row to anchor on.
    const someEntry = await prisma.entry.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (!someEntry) return; // empty DB — skip rather than fail

    const spy = jest.spyOn(repo, 'getGlobalAroundEntry');
    spy.mockClear();

    await service.getEntryAround(someEntry.id, 3);
    await service.getEntryAround(someEntry.id, 3);

    // Both calls must reach the repo — there is intentionally no cache
    // for entry-specific slices.
    expect(spy).toHaveBeenCalledTimes(2);

    // And no `leaderboard:around:*` keys should have been created.
    const aroundKeys = await redis.keys('leaderboard:around:*');
    expect(aroundKeys).toHaveLength(0);

    spy.mockRestore();
  });
});
