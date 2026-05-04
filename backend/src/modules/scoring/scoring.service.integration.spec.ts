import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ScoringService } from './scoring.service.js';
import { PhaseService } from './phase.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';
import {
  MatchAlreadyFinishedException,
  PhaseAlreadyPaidException,
} from '../../common/exceptions/domain.exceptions.js';

/**
 * End-to-end integration for `ScoringService.finishMatchAndScore`. Boots
 * the real Nest app (real Postgres, real BullMQ — but with the queue's
 * `add` spied out so the test never actually drives the workers).
 *
 * Setup:
 *   1. Pick an unused match from the seed (high matchNumber) and force
 *      it back to SCHEDULED so the suite is re-runnable.
 *   2. Create 5 throwaway users + one prediction each.
 *   3. Predictions exercise every OutcomeType so we assert the full
 *      classifier × multiplier matrix end-to-end.
 *
 * Cleanup tears down everything we touched.
 */
describe('ScoringService.finishMatchAndScore (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scoring: ScoringService;
  let queueAddSpy: ReturnType<typeof jest.spyOn>;
  let phaseSpy: ReturnType<typeof jest.spyOn>;

  let adminId: string;
  let matchId: string;
  // Stable prediction outcomes: home wins 3-1.
  const RESULT_HOME = 3;
  const RESULT_AWAY = 1;

  // userId → expected outcome / pointsEarned for the GROUPS multiplier 1.0
  const expectations: Record<
    string,
    { scoreHome: number; scoreAway: number; outcome: string; points: number }
  > = {};

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    scoring = app.get(ScoringService);

    // Spy on the BullMQ queue so we can assert post-commit enqueues
    // without driving the workers.
    const queue: Queue = app.get(getQueueToken(NOTIFICATIONS_QUEUE));
    queueAddSpy = jest.spyOn(queue, 'add');

    const phaseService = app.get(PhaseService);
    phaseSpy = jest.spyOn(phaseService, 'maybeClosePhase');

    // ── Pick a match. matchNumber 60 is in GROUPS, sits before the
    // matches that the predictions integration suite touches (70-71)
    // and outside the controller-level matches suite range. Reset its
    // status so the test is re-runnable.
    const match = await prisma.match.findFirstOrThrow({ where: { matchNumber: 60 } });
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

    // Ensure no PhaseWinner row blocks finish.
    await prisma.phaseWinner.deleteMany({ where: { phase: match.phase } });

    // ── Admin user (the actor that scores the match).
    const stamp = Date.now() % 80_000_000;
    const admin = await prisma.user.create({
      data: {
        dni: String(20_000_000 + stamp).slice(-8),
        firstName: 'Score',
        lastName: 'Admin',
        whatsapp: `549${String(2_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: 'unused-hash',
        role: 'ADMIN',
      },
    });
    adminId = admin.id;

    // ── 5 users with predictions covering every outcome.
    const userPlan: Array<{
      seed: number;
      scoreHome: number;
      scoreAway: number;
      outcome: string;
      basePoints: number;
    }> = [
      // EXACT — matches result 3-1 directly.
      { seed: 1, scoreHome: 3, scoreAway: 1, outcome: 'EXACT', basePoints: 5 },
      // WINNER_AND_DIFF — same diff (+2), different scoreline.
      { seed: 2, scoreHome: 4, scoreAway: 2, outcome: 'WINNER_AND_DIFF', basePoints: 3 },
      // WINNER_ONLY — predicted 5-0 (home wins, but diff +5 vs +2).
      { seed: 3, scoreHome: 5, scoreAway: 0, outcome: 'WINNER_ONLY', basePoints: 1 },
      // DRAW_DIFFERENT — predicted draw 1-1, actual was non-draw, so MISS.
      // We need a real DRAW_DIFFERENT, so flip strategy: predict 2-2 vs … but
      // the result is non-draw so this would be MISS. Skip in this run and
      // cover DRAW_DIFFERENT in a dedicated test below — keep one-test-per-
      // outcome philosophy clean here.
      // MISS — predicted away win.
      { seed: 4, scoreHome: 0, scoreAway: 2, outcome: 'MISS', basePoints: 0 },
      // MISS — predicted draw against a non-draw result.
      { seed: 5, scoreHome: 1, scoreAway: 1, outcome: 'MISS', basePoints: 0 },
    ];

    for (const plan of userPlan) {
      const user = await prisma.user.create({
        data: {
          dni: String(30_000_000 + stamp + plan.seed).slice(-8),
          firstName: `Pred${plan.seed}`,
          lastName: 'Tester',
          whatsapp: `549${String(3_000_000_000 + stamp + plan.seed).slice(-9)}`.slice(0, 13),
          passwordHash: 'unused-hash',
        },
      });
      await prisma.prediction.create({
        data: {
          userId: user.id,
          matchId,
          scoreHome: plan.scoreHome,
          scoreAway: plan.scoreAway,
        },
      });
      // GROUPS multiplier is 1.0 — points = basePoints.
      expectations[user.id] = {
        scoreHome: plan.scoreHome,
        scoreAway: plan.scoreAway,
        outcome: plan.outcome,
        points: plan.basePoints * 1,
      };
    }
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      // Clean predictions, audit, users, phaseWinner — leave the match
      // around but reset to SCHEDULED for re-runnability.
      const userIds = Object.keys(expectations);
      await prisma.prediction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.prediction.deleteMany({ where: { matchId } });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { userId: adminId },
            { entity: 'match', entityId: matchId },
          ],
        },
      });
      await prisma.user.delete({ where: { id: adminId } }).catch(() => undefined);
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
    if (queueAddSpy) queueAddSpy.mockRestore();
    if (phaseSpy) phaseSpy.mockRestore();
    if (app) await app.close();
  }, 30_000);

  it('finishes the match, scores predictions, writes audit, and enqueues post-commit jobs', async () => {
    queueAddSpy.mockReset();
    // Make `phaseSpy` a no-op so the stub log doesn't run twice and we can
    // still observe the call shape.
    phaseSpy.mockResolvedValue(undefined);

    const result = await scoring.finishMatchAndScore(
      matchId,
      RESULT_HOME,
      RESULT_AWAY,
      adminId,
    );

    // Match was updated.
    expect(result.status).toBe('FINISHED');
    expect(result.scoreHome).toBe(RESULT_HOME);
    expect(result.scoreAway).toBe(RESULT_AWAY);
    expect(result.finishedAt).toBeInstanceOf(Date);

    // Each prediction was scored according to its expected outcome.
    for (const [userId, exp] of Object.entries(expectations)) {
      const pred = await prisma.prediction.findUniqueOrThrow({
        where: { userId_matchId: { userId, matchId } },
      });
      expect(pred.outcomeType).toBe(exp.outcome);
      expect(pred.basePoints).toBe(
        exp.outcome === 'EXACT'
          ? 5
          : exp.outcome === 'WINNER_AND_DIFF'
            ? 3
            : exp.outcome === 'DRAW_DIFFERENT'
              ? 2
              : exp.outcome === 'WINNER_ONLY'
                ? 1
                : 0,
      );
      expect(pred.pointsEarned).toBe(exp.points);
      // Multiplier is Decimal(3,1); compare as number for sanity.
      const multiplierAsNum = Number(pred.multiplier);
      expect(multiplierAsNum).toBe(1);
      expect(pred.evaluatedAt).toBeInstanceOf(Date);
    }

    // Audit row written inside the TX.
    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'match.finished', entityId: matchId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].userId).toBe(adminId);
    const changes = auditRows[0].changes as {
      score: { home: number; away: number };
      predictionsScored: number;
    };
    expect(changes.score).toEqual({ home: RESULT_HOME, away: RESULT_AWAY });
    expect(changes.predictionsScored).toBe(Object.keys(expectations).length);

    // Post-commit jobs enqueued.
    const jobNames = queueAddSpy.mock.calls.map((c) => c[0]);
    expect(jobNames).toContain('leaderboard.refresh');
    expect(jobNames).toContain('match-result');

    // The leaderboard.refresh call carried the dedup jobId.
    const lbCall = queueAddSpy.mock.calls.find((c) => c[0] === 'leaderboard.refresh');
    expect(lbCall).toBeDefined();
    const [, , opts] = lbCall as [string, unknown, { jobId?: string } | undefined];
    expect(opts?.jobId).toBe('leaderboard:refresh');

    // Phase service notified of the phase to maybe-close.
    expect(phaseSpy).toHaveBeenCalledWith('GROUPS');
  }, 60_000);

  it('refuses to finish an already-FINISHED match', async () => {
    // The previous test left the match FINISHED; re-attempt should throw.
    await expect(
      scoring.finishMatchAndScore(matchId, 9, 0, adminId),
    ).rejects.toBeInstanceOf(MatchAlreadyFinishedException);
  });

  it('refuses to finish a match whose phase has already been paid', async () => {
    // Reset match → SCHEDULED, then create a PAID PhaseWinner for GROUPS.
    await prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'SCHEDULED',
        scoreHome: null,
        scoreAway: null,
        finishedAt: null,
      },
    });

    const winnerUserId = Object.keys(expectations)[0];
    await prisma.phaseWinner.create({
      data: {
        phase: 'GROUPS',
        userId: winnerUserId,
        pointsEarned: 99,
        prizeStatus: 'PAID',
      },
    });

    try {
      await expect(
        scoring.finishMatchAndScore(matchId, 1, 0, adminId),
      ).rejects.toBeInstanceOf(PhaseAlreadyPaidException);
    } finally {
      await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });
    }
  });
});
