import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ScoringService } from '../scoring/scoring.service.js';
import { PhaseService } from '../scoring/phase.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

/**
 * End-to-end integration for `LeaderboardRefreshProcessor`. Boots the
 * full Nest app (real Postgres, real BullMQ, real Redis), drives a
 * `finishMatchAndScore`, and polls the materialized view until the
 * worker has refreshed it.
 *
 * The previous-suite stubs (PhaseService.maybeClosePhase) are also
 * stubbed out here so we never accidentally trigger a phase closure
 * with our throwaway data.
 */
describe('LeaderboardRefreshProcessor (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scoring: ScoringService;
  let phase: PhaseService;
  let queue: Queue;

  let adminId: string;
  let userId: string;
  let matchId: string;

  // Reads the user's row in the MV (returns null if not yet refreshed
  // OR the user truly isn't in the MV — the test setup ensures this
  // is the only ambiguity that matters).
  async function readMvRow(uid: string) {
    const rows = await prisma.$queryRaw<
      Array<{ user_id: string; total_points: bigint }>
    >`SELECT user_id, total_points FROM leaderboard_global WHERE user_id = ${uid}`;
    return rows[0] ?? null;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    scoring = app.get(ScoringService);
    phase = app.get(PhaseService);
    queue = app.get(getQueueToken(NOTIFICATIONS_QUEUE));

    // Stub maybeClosePhase so the test stays focused on MV refresh.
    jest.spyOn(phase, 'maybeClosePhase').mockResolvedValue();

    // Pick a match that's not used by the other scoring suites.
    const match = await prisma.match.findFirstOrThrow({ where: { matchNumber: 63 } });
    matchId = match.id;
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

    // Stamp combines wall-clock millis + a process-pid-derived nonce so
    // overlapping test re-runs (e.g. against a sticky DB) don't collide
    // on the unique DNI/whatsapp constraints.
    const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
    const admin = await prisma.user.create({
      data: {
        dni: String(50_000_000 + stamp).slice(-8),
        firstName: 'Mv',
        lastName: 'Admin',
        whatsapp: `549${String(5_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: 'unused',
        role: 'ADMIN',
      },
    });
    adminId = admin.id;

    const userStamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
    const user = await prisma.user.create({
      data: {
        dni: String(60_000_000 + userStamp).slice(-8),
        firstName: 'Mv',
        lastName: 'Pred',
        whatsapp: `549${String(6_000_000_000 + userStamp).slice(-9)}`.slice(0, 13),
        passwordHash: 'unused',
      },
    });
    userId = user.id;

    await prisma.prediction.create({
      data: {
        userId,
        matchId,
        scoreHome: 2,
        scoreAway: 1, // EXACT vs upcoming result — 5 base points × 1.0 multiplier.
      },
    });

    // Give the BullMQ worker a moment to attach its blocking listener.
    await new Promise((r) => setTimeout(r, 1500));
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.prediction.deleteMany({ where: { matchId } });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { entity: 'match', entityId: matchId },
            { userId: adminId },
          ],
        },
      });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: adminId } }).catch(() => undefined);
      await prisma.match.update({
        where: { id: matchId },
        data: {
          status: 'SCHEDULED',
          scoreHome: null,
          scoreAway: null,
          finishedAt: null,
        },
      });
      // Final refresh so the global MV doesn't carry our test users into
      // subsequent runs (DELETE invalidated the rows but the MV is a
      // snapshot — without a refresh, stale rows would linger).
      await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
    }
    if (app) await app.close();
  }, 30_000);

  it('refreshes the materialized view shortly after finishMatchAndScore', async () => {
    // Sanity: refresh the MV BEFORE finish so the test user is at 0 points.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
    const baseline = await readMvRow(userId);
    expect(baseline?.total_points ?? 0n).toBe(0n);

    // Drive scoring. The post-commit step enqueues `leaderboard.refresh`.
    await scoring.finishMatchAndScore(matchId, 2, 1, adminId);

    // Poll the MV — the worker is async, so we wait up to ~10s.
    const deadline = Date.now() + 10_000;
    let refreshed: Awaited<ReturnType<typeof readMvRow>> = null;
    while (Date.now() < deadline) {
      refreshed = await readMvRow(userId);
      if (refreshed && Number(refreshed.total_points) === 5) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(refreshed).not.toBeNull();
    expect(Number(refreshed!.total_points)).toBe(5);
  }, 30_000);
});
