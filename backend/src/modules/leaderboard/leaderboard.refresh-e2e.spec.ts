import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.service.js';
import { PhaseService } from '../scoring/phase.service.js';

/**
 * End-to-end test for the full scoring → leaderboard.refresh →
 * cache-invalidate → public read pipeline. Verifies that:
 *
 *   1. Admin POST /admin/matches/:id/finish enqueues `leaderboard.refresh`.
 *   2. The worker refreshes the MV and drops the leaderboard:* keys.
 *   3. GET /leaderboard/global returns the new pointsEarned for the user
 *      WITHIN the 60s TTL window — i.e. the cache invalidation worked.
 */
describe('Leaderboard refresh after scoring (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let phase: PhaseService;
  let adminToken: string;
  let userId: string;
  let matchId: string;
  // Snapshot of the original match state so the suite can restore it.
  let matchSnapshot: {
    status: 'SCHEDULED' | 'LOCKED' | 'IN_PROGRESS' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
    scoreHome: number | null;
    scoreAway: number | null;
    finishedAt: Date | null;
  };
  const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;

  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS_CLIENT);
    phase = app.get(PhaseService);

    // Stub maybeClosePhase: the throwaway match shouldn't trigger
    // GROUPS phase closure for the seeded fixture data.
    jest.spyOn(phase, 'maybeClosePhase').mockResolvedValue();

    // Pick a match outside ranges used by other suites: 65 (60-64 used,
    // 70/71 used by predictions suites).
    const match = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 65 },
    });
    matchId = match.id;
    matchSnapshot = {
      status: match.status,
      scoreHome: match.scoreHome,
      scoreAway: match.scoreAway,
      finishedAt: match.finishedAt,
    };
    await prisma.prediction.deleteMany({ where: { matchId } });
    await prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'SCHEDULED',
        scoreHome: null,
        scoreAway: null,
        finishedAt: null,
      },
    });
    await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });

    // Admin login.
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    if (adminLogin.status !== 200) {
      throw new Error(
        `Admin login failed (status ${adminLogin.status}). Run Phase 2 seed.`,
      );
    }
    adminToken = adminLogin.body.accessToken;

    // Spawn one user with one EXACT prediction. After scoring the match
    // 2-1, they should land at exactly 5 points (5 base × 1.0 GROUPS
    // multiplier).
    const user = await prisma.user.create({
      data: {
        dni: String(90_000_000 + stamp).slice(-8),
        firstName: 'Lb',
        lastName: 'E2E',
        whatsapp: `549${String(9_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: 'unused',
      },
    });
    userId = user.id;

    await prisma.prediction.create({
      data: {
        userId,
        matchId,
        scoreHome: 2,
        scoreAway: 1,
      },
    });

    // Clear any stale cache entries from other tests.
    const stale = await redis.keys('leaderboard:*');
    if (stale.length) await redis.del(...stale);

    // Refresh once so the user's row is in the MV at 0 points.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;

    // Give the BullMQ worker a beat to attach its blocking listener.
    await new Promise((r) => setTimeout(r, 1500));
  }, 60_000);

  afterAll(async () => {
    if (!prisma) {
      if (app) await app.close();
      return;
    }
    if (matchId) {
      await prisma.prediction.deleteMany({ where: { matchId } });
      await prisma.auditLog.deleteMany({
        where: { entity: 'match', entityId: matchId },
      });
      await prisma.match.update({
        where: { id: matchId },
        data: matchSnapshot,
      });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    // Final refresh so the test user's row leaves the MV.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
    if (redis) {
      const keys = await redis.keys('leaderboard:*');
      if (keys.length) await redis.del(...keys);
    }
    if (app) await app.close();
  }, 30_000);

  it('finishMatch → worker refreshes MV → /leaderboard/global reflects new points', async () => {
    // 1) Sanity: user is in the MV at 0 points before the score.
    const before = await prisma.$queryRaw<Array<{ total_points: bigint }>>`
      SELECT total_points FROM leaderboard_global WHERE user_id = ${userId}
    `;
    expect(Number(before[0]?.total_points ?? 0n)).toBe(0);

    // Prime the cache for /leaderboard/global so we can verify the
    // worker's invalidation actually drops the entry.
    const primed = await request(app.getHttpServer()).get('/leaderboard/global');
    expect(primed.status).toBe(200);
    const cachedKey = await redis.get('leaderboard:global:1:50');
    expect(cachedKey).not.toBeNull(); // cache populated

    // 2) Admin finishes the match. Service enqueues `leaderboard.refresh`.
    const finish = await request(app.getHttpServer())
      .post(`/admin/matches/${matchId}/finish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 2, scoreAway: 1 });
    expect(finish.status).toBe(201);

    // 3) Poll the MV until the worker has processed the refresh job.
    //    The processor also calls invalidate(), which drops the cached
    //    /global page; that's how step 4 sees fresh data.
    const deadline = Date.now() + 10_000;
    let mvPoints = 0;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ total_points: bigint }>>`
        SELECT total_points FROM leaderboard_global WHERE user_id = ${userId}
      `;
      mvPoints = Number(rows[0]?.total_points ?? 0n);
      if (mvPoints === 5) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(mvPoints).toBe(5);

    // 4) GET /leaderboard/global must return the updated points. Without
    //    invalidation the cached payload from `primed` would still pin
    //    the user at 0; this assertion proves the worker dropped the
    //    cache key.
    const after = await request(app.getHttpServer()).get('/leaderboard/global');
    expect(after.status).toBe(200);
    const meRow = (after.body.rows as Array<{ user_id: string; total_points: number }>).find(
      (r) => r.user_id === userId,
    );
    expect(meRow).toBeDefined();
    expect(meRow!.total_points).toBe(5);
  }, 30_000);
});
