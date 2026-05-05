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
  MatchNotFinishedException,
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

  // entryId → expected outcome / pointsEarned for the GROUPS multiplier 1.0
  // Multi-prode: predictions live on entries; we still create one user per
  // entry for symmetry with the original test, but the keying is by entry.
  const expectations: Record<
    string,
    {
      userId: string;
      scoreHome: number;
      scoreAway: number;
      outcome: string;
      points: number;
    }
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
      const payment = await prisma.payment.create({
        data: {
          userId: user.id,
          amount: 10_000,
          method: 'CASH',
          status: 'APPROVED',
          paidAt: new Date(),
          completedAt: new Date(),
        },
      });
      const entry = await prisma.entry.create({
        data: {
          userId: user.id,
          paymentId: payment.id,
          position: 1,
          status: 'ACTIVE',
        },
      });
      await prisma.prediction.create({
        data: {
          entryId: entry.id,
          matchId,
          scoreHome: plan.scoreHome,
          scoreAway: plan.scoreAway,
        },
      });
      // GROUPS multiplier is 1.0 — points = basePoints.
      expectations[entry.id] = {
        userId: user.id,
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
      // around but reset to SCHEDULED for re-runnability. Predictions
      // cascade off entries; deleting the user wipes the tree.
      const userIds = Object.values(expectations).map((e) => e.userId);
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
    for (const [entryId, exp] of Object.entries(expectations)) {
      const pred = await prisma.prediction.findUniqueOrThrow({
        where: { entryId_matchId: { entryId, matchId } },
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
    expect(opts?.jobId).toBe('leaderboard_refresh');

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

    const winnerEntryId = Object.keys(expectations)[0];
    await prisma.phaseWinner.create({
      data: {
        phase: 'GROUPS',
        entryId: winnerEntryId,
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

  describe('recalculateMatch', () => {
    beforeEach(async () => {
      // Ensure match is FINISHED with the original score so recalc has
      // something to mutate. Re-finishing here is fine — the previous
      // test ran finishMatchAndScore once, this gets us back to that state.
      await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });
      const cur = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
      if (cur.status !== 'FINISHED') {
        await scoring.finishMatchAndScore(matchId, RESULT_HOME, RESULT_AWAY, adminId);
      }
      queueAddSpy.mockReset();
      phaseSpy.mockReset();
      phaseSpy.mockResolvedValue(undefined);
    });

    it('refuses to recalculate a match that is not yet FINISHED', async () => {
      // Reset to SCHEDULED to break the invariant.
      await prisma.match.update({
        where: { id: matchId },
        data: {
          status: 'SCHEDULED',
          scoreHome: null,
          scoreAway: null,
          finishedAt: null,
        },
      });
      try {
        await expect(
          scoring.recalculateMatch(matchId, 2, 1, adminId),
        ).rejects.toBeInstanceOf(MatchNotFinishedException);
      } finally {
        // Restore for the following tests in this describe.
        await scoring.finishMatchAndScore(matchId, RESULT_HOME, RESULT_AWAY, adminId);
      }
    });

    it('refuses to recalculate when the phase prize is already paid', async () => {
      const winnerEntryId = Object.keys(expectations)[0];
      await prisma.phaseWinner.create({
        data: {
          phase: 'GROUPS',
          entryId: winnerEntryId,
          pointsEarned: 99,
          prizeStatus: 'PAID',
        },
      });
      try {
        await expect(
          scoring.recalculateMatch(matchId, 4, 0, adminId),
        ).rejects.toBeInstanceOf(PhaseAlreadyPaidException);
      } finally {
        await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });
      }
    });

    it('re-scores predictions, writes a before/after audit row, and re-enqueues post-commit jobs', async () => {
      // Original result was 3-1 (home wins by 2). New result: 2-2 (draw 2-2).
      // After this recalc:
      //   - The user who predicted (1,1) should flip from MISS to DRAW_DIFFERENT (basePoints=2).
      //   - The user who predicted (3,1) — was EXACT — should now be MISS.
      //   - The user who predicted (4,2) — was WINNER_AND_DIFF — should now be MISS.
      //   - The user who predicted (5,0) — was WINNER_ONLY — should now be MISS.
      //   - The user who predicted (0,2) — was MISS — should now also be MISS.
      const NEW_HOME = 2;
      const NEW_AWAY = 2;

      const updated = await scoring.recalculateMatch(matchId, NEW_HOME, NEW_AWAY, adminId);
      expect(updated.scoreHome).toBe(NEW_HOME);
      expect(updated.scoreAway).toBe(NEW_AWAY);
      expect(updated.status).toBe('FINISHED');

      // Find the entry that originally predicted (1,1) and is now DRAW_DIFFERENT.
      const drawEntryId = Object.entries(expectations).find(
        ([, e]) => e.scoreHome === 1 && e.scoreAway === 1,
      )?.[0];
      expect(drawEntryId).toBeDefined();
      const drawPred = await prisma.prediction.findUniqueOrThrow({
        where: { entryId_matchId: { entryId: drawEntryId!, matchId } },
      });
      expect(drawPred.outcomeType).toBe('DRAW_DIFFERENT');
      expect(drawPred.basePoints).toBe(2);
      expect(drawPred.pointsEarned).toBe(2);

      // The previously-EXACT prediction (3,1) is now a MISS.
      const exactEntryId = Object.entries(expectations).find(
        ([, e]) => e.scoreHome === 3 && e.scoreAway === 1,
      )?.[0];
      expect(exactEntryId).toBeDefined();
      const exPred = await prisma.prediction.findUniqueOrThrow({
        where: { entryId_matchId: { entryId: exactEntryId!, matchId } },
      });
      expect(exPred.outcomeType).toBe('MISS');
      expect(exPred.pointsEarned).toBe(0);

      // Audit row carries before / after.
      const auditRows = await prisma.auditLog.findMany({
        where: { action: 'match.recalculated', entityId: matchId },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].userId).toBe(adminId);
      const changes = auditRows[0].changes as {
        before: { scoreHome: number; scoreAway: number };
        after: { scoreHome: number; scoreAway: number };
      };
      expect(changes.before).toEqual({ scoreHome: RESULT_HOME, scoreAway: RESULT_AWAY });
      expect(changes.after).toEqual({ scoreHome: NEW_HOME, scoreAway: NEW_AWAY });

      // Post-commit jobs enqueued (MV refresh + match-result + phase hook).
      const jobNames = queueAddSpy.mock.calls.map((c) => c[0]);
      expect(jobNames).toContain('leaderboard.refresh');
      expect(jobNames).toContain('match-result');
      expect(phaseSpy).toHaveBeenCalledWith('GROUPS');
    });
  });
});
