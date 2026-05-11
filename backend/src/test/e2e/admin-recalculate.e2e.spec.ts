import { jest } from '@jest/globals';
import request from 'supertest';
import {
  ADMIN_LOGIN,
  createE2EApp,
  uniqueDni,
  uniqueWhatsapp,
  type E2EAppHandles,
} from '../helpers/e2e-app.js';
import { ScoringService } from '../../modules/scoring/scoring.service.js';
import { PhaseService } from '../../modules/scoring/phase.service.js';

/**
 * Spec section 10 — E2E flow #5: admin recalculate.
 *
 * Two cases:
 *
 *   1. Admin recalculates a FINISHED match. Predictions are re-scored
 *      with the new outcome, and an audit row records `before` /
 *      `after` so operators can answer "what changed and when".
 *
 *   2. Once the phase prize is PAID, recalculate is locked — phases
 *      are immutable past payout. The endpoint returns 409
 *      `PHASE_ALREADY_PAID`.
 *
 * The first case finishes the match through `ScoringService` directly so
 * we have a deterministic FINISHED state without going through the full
 * admin endpoint dance (already covered in `prediction-scoring.e2e.spec.ts`
 * and `phase-close.e2e.spec.ts`). This keeps the test focused on the
 * recalc path.
 */
describe('E2E flow #5: admin recalculate match', () => {
  let h: E2EAppHandles;
  let scoring: ScoringService;
  let phase: PhaseService;
  let adminToken: string;
  let adminUserId: string;
  let userId: string;
  let entryId: string;
  let matchId: string;
  let matchSnapshot: {
    status:
      | 'SCHEDULED'
      | 'LOCKED'
      | 'IN_PROGRESS'
      | 'FINISHED'
      | 'POSTPONED'
      | 'CANCELLED';
    scoreHome: number | null;
    scoreAway: number | null;
    finishedAt: Date | null;
    predictionsLockAt: Date;
  };
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    h = await createE2EApp();
    await h.cleanDb();

    scoring = h.app.get(ScoringService);
    phase = h.app.get(PhaseService);

    // We're going to finish a single match in a populated phase; the auto
    // phase-close inside scoring would otherwise count the rest of the
    // phase's pending matches and short-circuit, which is fine, but
    // stubbing makes the assertions independent of the seed's other
    // matches changing state.
    jest.spyOn(phase, 'maybeClosePhase').mockResolvedValue();

    const adminLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send(ADMIN_LOGIN);
    adminToken = adminLogin.body.accessToken;
    adminUserId = adminLogin.body.user.id;

    // Pick a free GROUPS match.
    const match = await h.prisma.match.findFirstOrThrow({
      where: { matchNumber: 68 },
    });
    matchId = match.id;
    matchSnapshot = {
      status: match.status,
      scoreHome: match.scoreHome,
      scoreAway: match.scoreAway,
      finishedAt: match.finishedAt,
      predictionsLockAt: match.predictionsLockAt,
    };

    // Reset to SCHEDULED, no score, lock in the future.
    await h.prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'SCHEDULED',
        scoreHome: null,
        scoreAway: null,
        finishedAt: null,
        predictionsLockAt: new Date(Date.now() + 6 * 3600 * 1000),
      },
    });
    await h.prisma.prediction.deleteMany({ where: { matchId } });
    await h.prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });

    // Spawn a user + entry and seed a 2-1 prediction.
    const u = await h.prisma.user.create({
      data: {
        dni: uniqueDni(),
        firstName: 'Recalc',
        lastName: 'User',
        whatsapp: uniqueWhatsapp(),
        passwordHash: 'unused',
      },
    });
    userId = u.id;
    const payment = await h.prisma.payment.create({
      data: {
        userId,
        amount: 10_000,
        method: 'CASH',
        status: 'APPROVED',
        paidAt: new Date(),
        completedAt: new Date(),
      },
    });
    const entry = await h.prisma.entry.create({
      data: {
        userId,
        paymentId: payment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });
    entryId = entry.id;
    await h.prisma.prediction.create({
      data: { entryId, matchId, scoreHome: 2, scoreAway: 1 },
    });

    // Use the service directly so the tests starts with a known FINISHED
    // state (admin endpoint also works; this is faster + unambiguous).
    await scoring.finishMatchAndScore(matchId, 2, 1, adminUserId);
  }, 60_000);

  afterAll(async () => {
    if (h?.prisma) {
      await h.prisma.prediction.deleteMany({ where: { matchId } });
      await h.prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });
      await h.prisma.auditLog.deleteMany({
        where: { entity: 'match', entityId: matchId },
      });
      if (matchId && matchSnapshot) {
        await h.prisma.match.update({
          where: { id: matchId },
          data: matchSnapshot,
        });
      }
      await h.cleanDb();
    }
    if (h?.closeApp) await h.closeApp();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  it('admin recalculate → predictions re-scored, audit log records before/after', async () => {
    // Sanity: the prediction earned 5 pts (EXACT, 5 base × 1.0 GROUPS).
    const before = await h.prisma.prediction.findUniqueOrThrow({
      where: { entryId_matchId: { entryId, matchId } },
    });
    expect(before.outcomeType).toBe('EXACT');
    expect(before.pointsEarned).toBe(5);

    // ── 1. POST /admin/matches/:id/recalculate with a different score.
    //      With the user's prediction (2-1) and the new final (3-2), the
    //      outcome becomes WINNER_AND_DIFF (correct winner + same goal
    //      difference). 3 base × 1.0 = 3 pts.
    const recalc = await request(h.app.getHttpServer())
      .post(`/admin/matches/${matchId}/recalculate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 3, scoreAway: 2 });
    expect(recalc.status).toBe(201);
    expect(recalc.body.scoreHome).toBe(3);
    expect(recalc.body.scoreAway).toBe(2);
    expect(recalc.body.status).toBe('FINISHED');

    // ── 2. The prediction was re-evaluated.
    const after = await h.prisma.prediction.findUniqueOrThrow({
      where: { entryId_matchId: { entryId, matchId } },
    });
    expect(after.outcomeType).toBe('WINNER_AND_DIFF');
    expect(after.pointsEarned).toBe(3);

    // ── 3. Audit row carries the before/after diff.
    const auditRow = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'match.recalculated', entityId: matchId },
    });
    const changes = auditRow.changes as {
      before: { scoreHome: number; scoreAway: number };
      after: { scoreHome: number; scoreAway: number };
      predictionsScored: number;
    };
    expect(changes.before).toEqual({ scoreHome: 2, scoreAway: 1 });
    expect(changes.after).toEqual({ scoreHome: 3, scoreAway: 2 });
    expect(changes.predictionsScored).toBe(1);
  }, 30_000);

  it('phase already paid → 409 PHASE_ALREADY_PAID', async () => {
    // Insert a PhaseWinner row marked PAID for GROUPS (the phase of our
    // test match). Recalculate must refuse to touch a phase that already
    // had its prize paid out — points are immutable past payout.
    await h.prisma.phaseWinner.upsert({
      where: { phase: 'GROUPS' },
      create: {
        phase: 'GROUPS',
        entryId,
        pointsEarned: 3,
        prizeStatus: 'PAID',
      },
      update: { prizeStatus: 'PAID' },
    });

    const blocked = await request(h.app.getHttpServer())
      .post(`/admin/matches/${matchId}/recalculate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 5, scoreAway: 0 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PHASE_ALREADY_PAID');

    // Predictions stayed at 3 pts (the previous test's recalculate result).
    const inDb = await h.prisma.prediction.findUniqueOrThrow({
      where: { entryId_matchId: { entryId, matchId } },
    });
    expect(inDb.pointsEarned).toBe(3);
  }, 30_000);
});
