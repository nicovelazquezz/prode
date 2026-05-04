import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  MATCH_RESULT_JOB,
  MatchResultProcessor,
  type MatchResultJobData,
} from './match-result.processor.js';

/**
 * Integration test for `MatchResultProcessor.handle`. We boot the real
 * Nest container so the processor talks to Postgres, then we:
 *
 *   1. Use a seed match (#92) and force-finish it with a deterministic
 *      score (1-1) so we control which predictions hit each pointsEarned
 *      bucket.
 *   2. Create three users:
 *        - winner: predicted 1-1, pointsEarned > 0, opted in → SHOULD recap.
 *        - misser: predicted 0-3, pointsEarned = 0 → MUST NOT recap.
 *        - opted-out winner: predicted 1-1, pointsEarned > 0,
 *          whatsappOptIn=false → MUST NOT recap.
 *   3. Invoke handle({ matchId }).
 *   4. Assert one Notification row landed for the winner only.
 *
 * Re-runs the handler at the end to verify the dedupKey collapses the
 * second invocation into a no-op (a recálculo of the same match must
 * not double-message).
 */
describe('MatchResultProcessor.handle (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: MatchResultProcessor;

  const stamp = Date.now();
  const winnerDni = `40${String(stamp).slice(-7)}`;
  const misserDni = `41${String(stamp).slice(-7)}`;
  const optedOutDni = `42${String(stamp).slice(-7)}`;

  let winnerId: string;
  let misserId: string;
  let optedOutId: string;
  let matchId: string;

  type MatchSnapshot = {
    id: string;
    status: string;
    scoreHome: number | null;
    scoreAway: number | null;
    finishedAt: Date | null;
  };
  let matchSnapshot: MatchSnapshot | null = null;

  const createdNotificationDedupKeys: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    processor = app.get(MatchResultProcessor);

    const target = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 92 },
    });
    matchId = target.id;
    matchSnapshot = {
      id: target.id,
      status: target.status,
      scoreHome: target.scoreHome,
      scoreAway: target.scoreAway,
      finishedAt: target.finishedAt,
    };

    // Force-finish the match: scoreHome=1, scoreAway=1.
    // Make sure both teams are populated so the recap message can
    // include the names without falling back to placeholders.
    const homeTeamId =
      target.homeTeamId ?? (await firstTeamId(prisma)).id;
    const awayTeamId =
      target.awayTeamId ?? (await firstTeamId(prisma, homeTeamId)).id;
    await prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'FINISHED',
        scoreHome: 1,
        scoreAway: 1,
        finishedAt: new Date(),
        homeTeamId,
        awayTeamId,
      },
    });

    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('SeedPass123', 10);

    const winner = await prisma.user.create({
      data: {
        dni: winnerDni,
        firstName: 'MR',
        lastName: 'Winner',
        whatsapp: `549${String(8_400_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: true,
      },
    });
    winnerId = winner.id;

    const misser = await prisma.user.create({
      data: {
        dni: misserDni,
        firstName: 'MR',
        lastName: 'Misser',
        whatsapp: `549${String(8_500_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: true,
      },
    });
    misserId = misser.id;

    const optedOut = await prisma.user.create({
      data: {
        dni: optedOutDni,
        firstName: 'MR',
        lastName: 'OptOut',
        whatsapp: `549${String(8_600_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: false,
      },
    });
    optedOutId = optedOut.id;

    // Predictions:
    //   - winner: exact match (1-1) → pointsEarned = 10 (or whatever
    //     scoring rules dictate; we set the exact field manually since
    //     this test bypasses ScoringService).
    //   - misser: pointsEarned = 0.
    //   - optedOut: same as winner but won't be notified.
    await prisma.prediction.createMany({
      data: [
        {
          userId: winnerId,
          matchId,
          scoreHome: 1,
          scoreAway: 1,
          outcomeType: 'EXACT',
          basePoints: 10,
          pointsEarned: 10,
          evaluatedAt: new Date(),
        },
        {
          userId: misserId,
          matchId,
          scoreHome: 0,
          scoreAway: 3,
          outcomeType: 'MISS',
          basePoints: 0,
          pointsEarned: 0,
          evaluatedAt: new Date(),
        },
        {
          userId: optedOutId,
          matchId,
          scoreHome: 1,
          scoreAway: 1,
          outcomeType: 'EXACT',
          basePoints: 10,
          pointsEarned: 10,
          evaluatedAt: new Date(),
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { dedupKey: { in: createdNotificationDedupKeys } },
            { userId: { in: [winnerId, misserId, optedOutId] } },
          ],
        },
      });
      await prisma.prediction.deleteMany({
        where: { matchId, userId: { in: [winnerId, misserId, optedOutId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [winnerId, misserId, optedOutId] } },
      });
      if (matchSnapshot) {
        await prisma.match.update({
          where: { id: matchSnapshot.id },
          data: {
            status: matchSnapshot.status as MatchSnapshot['status'],
            scoreHome: matchSnapshot.scoreHome,
            scoreAway: matchSnapshot.scoreAway,
            finishedAt: matchSnapshot.finishedAt,
          },
        });
      }
    }
    if (app) await app.close();
  }, 30_000);

  /** Builds a minimal Job stub that satisfies the handler's contract. */
  function makeJob(matchId: string): Job<MatchResultJobData> {
    return {
      id: 'mr_test',
      name: MATCH_RESULT_JOB,
      data: { matchId },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as unknown as Job<MatchResultJobData>;
  }

  it('enqueues a recap for scoring opted-in users only', async () => {
    const enqueued = await processor.handle(makeJob(matchId));
    expect(enqueued).toBe(1);

    const winnerKey = `match-result:${winnerId}:${matchId}`;
    createdNotificationDedupKeys.push(winnerKey);

    const winnerRow = await prisma.notification.findUnique({
      where: { dedupKey: winnerKey },
    });
    expect(winnerRow).not.toBeNull();
    expect(winnerRow?.channel).toBe('WHATSAPP');
    expect(winnerRow?.type).toBe('MATCH_RESULT');
    expect(winnerRow?.title).toBe('Resultado del partido');
    expect(winnerRow?.message).toContain('Sumaste 10 pts');
    expect(winnerRow?.message).toContain('1-1');
    expect(winnerRow?.message).toContain('resultado exacto');

    // Misser must NOT have a row.
    const misserRows = await prisma.notification.findMany({
      where: {
        userId: misserId,
        dedupKey: { startsWith: 'match-result:' },
      },
    });
    expect(misserRows).toHaveLength(0);

    // Opted-out user must NOT have a row.
    const optedOutRows = await prisma.notification.findMany({
      where: {
        userId: optedOutId,
        dedupKey: { startsWith: 'match-result:' },
      },
    });
    expect(optedOutRows).toHaveLength(0);
  });

  it('is idempotent on re-run (recálculo): no duplicate row for the same user/match', async () => {
    await processor.handle(makeJob(matchId));
    await processor.handle(makeJob(matchId));

    const winnerKey = `match-result:${winnerId}:${matchId}`;
    const rows = await prisma.notification.findMany({
      where: { dedupKey: winnerKey },
    });
    expect(rows).toHaveLength(1);
  });

  it('returns 0 when the match has no scoring users', async () => {
    // Find an arbitrary FINISHED match in the seed; if none exists,
    // skip — we only need to exercise the empty branch.
    const empty = await prisma.match.findFirst({
      where: { matchNumber: 93 },
    });
    if (!empty) return;
    // Make sure there are no predictions on it from this test.
    await prisma.prediction.deleteMany({ where: { matchId: empty.id } });
    await prisma.match.update({
      where: { id: empty.id },
      data: { status: 'FINISHED', scoreHome: 0, scoreAway: 0 },
    });
    const result = await processor.handle(makeJob(empty.id));
    expect(result).toBe(0);
    // Restore the seed match status so other suites don't see drift.
    await prisma.match.update({
      where: { id: empty.id },
      data: { status: 'SCHEDULED', scoreHome: null, scoreAway: null },
    });
  });
});

async function firstTeamId(prisma: PrismaService, exclude?: string) {
  return prisma.team.findFirstOrThrow({
    where: exclude ? { id: { not: exclude } } : {},
    orderBy: { fifaCode: 'asc' },
  });
}
