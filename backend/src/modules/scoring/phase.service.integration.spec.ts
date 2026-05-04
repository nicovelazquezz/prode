import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { PhaseService } from './phase.service.js';
import { MatchProgressionService } from './match-progression.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

/**
 * Integration test for `PhaseService.maybeClosePhase`. We can't run the
 * real "all 72 GROUPS matches FINISHED" scenario without polluting the
 * seeded data — instead, the suite carves out a single phase, GROUPS,
 * and stages it minimally:
 *
 *   - Pick one match (matchNumber 62) and finish it with a couple of
 *     predictions so `computePhaseWinner` has data to rank.
 *   - Spy on `prisma.match.count` so the suite can lie about pending
 *     matches (we don't want to actually finish all 72).
 *
 * The progression and notifications calls are also spied so we can
 * verify the orchestration without driving real workers.
 *
 * Cleanup: delete predictions/audit/users/PhaseWinner created here, plus
 * reset the touched match back to SCHEDULED.
 */
describe('PhaseService.maybeClosePhase (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let phaseService: PhaseService;
  let progression: MatchProgressionService;
  let queueAddSpy: ReturnType<typeof jest.spyOn>;
  let countSpy: ReturnType<typeof jest.spyOn>;
  let progressionSpies: Record<string, ReturnType<typeof jest.spyOn>> = {};

  let matchId: string;
  let matchNumber = 62;
  let userIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    phaseService = app.get(PhaseService);
    progression = app.get(MatchProgressionService);

    const queue: Queue = app.get(getQueueToken(NOTIFICATIONS_QUEUE));
    queueAddSpy = jest.spyOn(queue, 'add');

    progressionSpies = {
      r32: jest.spyOn(progression, 'populateRound32Matches').mockResolvedValue(),
      r16: jest.spyOn(progression, 'populateRound16Matches').mockResolvedValue(),
      qf: jest.spyOn(progression, 'populateQuarterMatches').mockResolvedValue(),
      sf: jest.spyOn(progression, 'populateSemiMatches').mockResolvedValue(),
      f: jest.spyOn(progression, 'populateFinalMatches').mockResolvedValue(),
    };

    // Carve out a match for the test.
    const match = await prisma.match.findFirstOrThrow({ where: { matchNumber } });
    matchId = match.id;

    await prisma.prediction.deleteMany({ where: { matchId } });
    await prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'FINISHED',
        scoreHome: 2,
        scoreAway: 1,
        finishedAt: new Date(),
      },
    });
    await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });

    // 3 throwaway users with evaluated predictions so the winner
    // computation has rows to work with.
    const stamp = Date.now() % 70_000_000;
    const plans = [
      { seed: 1, points: 5, exact: 1 }, // The winner — 5 points, 1 exact.
      { seed: 2, points: 3, exact: 0 }, // Second place — 3 points.
      { seed: 3, points: 5, exact: 0 }, // Tied on points but 0 exacts → loses tiebreak.
    ];
    for (const plan of plans) {
      const user = await prisma.user.create({
        data: {
          dni: String(40_000_000 + stamp + plan.seed).slice(-8),
          firstName: `Phase${plan.seed}`,
          lastName: 'Tester',
          whatsapp: `549${String(4_000_000_000 + stamp + plan.seed).slice(-9)}`.slice(0, 13),
          passwordHash: 'unused-hash',
        },
      });
      userIds.push(user.id);
      await prisma.prediction.create({
        data: {
          userId: user.id,
          matchId,
          // The actual scoreline doesn't matter — we override outcomeType
          // / pointsEarned directly to avoid having to drive scoring.
          scoreHome: plan.seed === 1 ? 2 : 0,
          scoreAway: plan.seed === 1 ? 1 : 0,
          outcomeType: plan.exact > 0 ? 'EXACT' : 'WINNER_ONLY',
          basePoints: plan.points,
          multiplier: 1,
          pointsEarned: plan.points,
          evaluatedAt: new Date(),
        },
      });
    }

    // Lie about pending matches so maybeClosePhase thinks GROUPS is done.
    countSpy = jest.spyOn(prisma.match, 'count').mockResolvedValue(0);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.prediction.deleteMany({ where: { matchId } });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { entity: 'phase', entityId: 'GROUPS' },
            { entity: 'match', entityId: matchId },
          ],
        },
      });
      await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });
      for (const id of userIds) {
        await prisma.user.delete({ where: { id } }).catch(() => undefined);
      }
      await prisma.match.update({
        where: { id: matchId },
        data: {
          status: 'SCHEDULED',
          scoreHome: null,
          scoreAway: null,
          finishedAt: null,
        },
      });
    }
    if (countSpy) countSpy.mockRestore();
    if (queueAddSpy) queueAddSpy.mockRestore();
    for (const s of Object.values(progressionSpies)) s.mockRestore();
    if (app) await app.close();
  }, 30_000);

  beforeEach(() => {
    queueAddSpy.mockClear();
    for (const s of Object.values(progressionSpies)) s.mockClear();
  });

  it('does nothing when matches are still pending', async () => {
    countSpy.mockResolvedValueOnce(7);
    await phaseService.maybeClosePhase('GROUPS');
    const winner = await prisma.phaseWinner.findUnique({ where: { phase: 'GROUPS' } });
    expect(winner).toBeNull();
    expect(progressionSpies.r32).not.toHaveBeenCalled();
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('closes the phase, picks the right winner, populates next phase, and notifies', async () => {
    await phaseService.maybeClosePhase('GROUPS');

    const winner = await prisma.phaseWinner.findUnique({ where: { phase: 'GROUPS' } });
    expect(winner).not.toBeNull();
    expect(winner!.userId).toBe(userIds[0]);
    expect(winner!.pointsEarned).toBe(5);

    // Audit row created.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'phase.closed', entityId: 'GROUPS' },
    });
    expect(audits).toHaveLength(1);
    const changes = audits[0].changes as {
      winner: { userId: string; points: number; exactCount: number };
    };
    expect(changes.winner.userId).toBe(userIds[0]);
    expect(changes.winner.points).toBe(5);
    expect(changes.winner.exactCount).toBe(1);

    // GROUPS → ROUND_32 populator called.
    expect(progressionSpies.r32).toHaveBeenCalledTimes(1);

    // Notification job enqueued.
    const notifCalls = queueAddSpy.mock.calls.filter((c) => c[0] === 'phase-winner');
    expect(notifCalls).toHaveLength(1);
    expect(notifCalls[0][1]).toEqual({ phase: 'GROUPS', userId: userIds[0] });
  });

  it('is idempotent: a second call after closure no-ops', async () => {
    // Phase was closed in the previous test.
    await phaseService.maybeClosePhase('GROUPS');
    expect(progressionSpies.r32).not.toHaveBeenCalled();
    expect(queueAddSpy).not.toHaveBeenCalled();
    const winners = await prisma.phaseWinner.count({ where: { phase: 'GROUPS' } });
    expect(winners).toBe(1);
  });

  it('computePhaseWinner ranks by points, then exact_count, then hits_count', async () => {
    const w = await phaseService.computePhaseWinner('GROUPS');
    expect(w).not.toBeNull();
    expect(w!.userId).toBe(userIds[0]);
    expect(w!.points).toBe(5);
    expect(w!.exactCount).toBe(1);
    // hitsCount = 1 (this user has one EXACT, which counts as a hit).
    expect(w!.hitsCount).toBe(1);
  });
});
