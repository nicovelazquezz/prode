import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import {
  ADMIN_LOGIN,
  createE2EApp,
  uniqueDni,
  uniqueWhatsapp,
  type E2EAppHandles,
} from '../helpers/e2e-app.js';
import { NOTIFICATIONS_QUEUE } from '../../modules/notifications/notifications.constants.js';
import { PhaseService } from '../../modules/scoring/phase.service.js';

/**
 * Spec section 10 — E2E flow #3: phase close.
 *
 * The smallest closeable phase in the seed is `FINAL` — exactly one match
 * (matchNumber 104). When that match goes FINISHED, `PhaseService.maybeClosePhase`
 * should:
 *
 *   1. Compute the phase winner (highest points across the phase).
 *   2. Insert a `PhaseWinner` row + `phase.closed` audit row in one TX.
 *   3. Enqueue the `phase-winner` notification job.
 *   4. Be idempotent — re-entering doesn't create a duplicate row.
 *
 * The test seeds two users with predictions on the FINAL match (one EXACT,
 * one WINNER_ONLY) so the tie-break ordering can pick the EXACT user as
 * the winner. The admin then finishes the match through the regular
 * `/admin/matches/:id/finish` endpoint and we verify the side-effects.
 */
describe('E2E flow #3: phase close (FINAL)', () => {
  let h: E2EAppHandles;
  let queue: Queue;
  let phaseService: PhaseService;
  let adminToken: string;
  let winnerUserId: string;
  let runnerUpUserId: string;
  let finalMatchId: string;
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

    // Pull the FINAL match (1-of-1 in the seed). Snapshot first so afterAll
    // can put it back as SCHEDULED for the next suite to use.
    const final = await h.prisma.match.findFirstOrThrow({
      where: { phase: 'FINAL' },
    });
    finalMatchId = final.id;
    matchSnapshot = {
      status: final.status,
      scoreHome: final.scoreHome,
      scoreAway: final.scoreAway,
      finishedAt: final.finishedAt,
      predictionsLockAt: final.predictionsLockAt,
    };

    // Reset to SCHEDULED with a future lock so two predictions can land
    // before the admin closes it.
    await h.prisma.match.update({
      where: { id: finalMatchId },
      data: {
        status: 'SCHEDULED',
        scoreHome: null,
        scoreAway: null,
        finishedAt: null,
        predictionsLockAt: new Date(Date.now() + 6 * 3600 * 1000),
      },
    });

    // Inline-create two USER rows (skip the public registration flow —
    // the prior suite already covers that, and what we care about here
    // is the phase-close behaviour). Same pattern as
    // `leaderboard.refresh-e2e.spec.ts`.
    const winner = await h.prisma.user.create({
      data: {
        dni: uniqueDni(),
        firstName: 'Winner',
        lastName: 'Final',
        whatsapp: uniqueWhatsapp(),
        passwordHash: 'unused',
        whatsappOptIn: true,
      },
    });
    winnerUserId = winner.id;

    const runnerUp = await h.prisma.user.create({
      data: {
        dni: uniqueDni(),
        firstName: 'Runner',
        lastName: 'Up',
        whatsapp: uniqueWhatsapp(),
        passwordHash: 'unused',
      },
    });
    runnerUpUserId = runnerUp.id;

    // Predictions: winner picks 2-1 (will match the final score → EXACT,
    // 5 base × 5.0 multiplier = 25 pts). Runner-up picks 3-1 (winner
    // correct, different diff → WINNER_ONLY, 1 × 5.0 = 5 pts).
    await h.prisma.prediction.createMany({
      data: [
        {
          userId: winnerUserId,
          matchId: finalMatchId,
          scoreHome: 2,
          scoreAway: 1,
        },
        {
          userId: runnerUpUserId,
          matchId: finalMatchId,
          scoreHome: 3,
          scoreAway: 1,
        },
      ],
    });

    queue = h.app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
    phaseService = h.app.get(PhaseService);

    // Admin login.
    const adminLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send(ADMIN_LOGIN);
    adminToken = adminLogin.body.accessToken;

    // Drain any leftover phase-winner / leaderboard.refresh jobs from
    // earlier suites so the queue snapshot we take below is meaningful.
    const stale = await queue.getJobs([
      'waiting',
      'delayed',
      'completed',
      'failed',
    ]);
    for (const j of stale) {
      if (j.name === 'phase-winner' || j.name === 'leaderboard.refresh') {
        await j.remove().catch(() => undefined);
      }
    }

    await new Promise((r) => setTimeout(r, 1500));
  }, 60_000);

  afterAll(async () => {
    if (h?.prisma) {
      await h.prisma.prediction.deleteMany({
        where: { matchId: finalMatchId },
      });
      await h.prisma.phaseWinner.deleteMany({ where: { phase: 'FINAL' } });
      await h.prisma.auditLog.deleteMany({
        where: { entity: 'match', entityId: finalMatchId },
      });
      await h.prisma.auditLog.deleteMany({
        where: { entity: 'phase', entityId: 'FINAL' },
      });
      if (matchSnapshot && finalMatchId) {
        await h.prisma.match.update({
          where: { id: finalMatchId },
          data: matchSnapshot,
        });
      }
      // Refresh + clean to make sure the test users vanish from the MV.
      await h.cleanDb();
      await h.prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
    }
    if (h?.closeApp) await h.closeApp();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  it('admin finishes FINAL → PhaseWinner row, audit log, phase-winner job; idempotent on retry', async () => {
    // Sanity: no PhaseWinner exists yet.
    const before = await h.prisma.phaseWinner.findUnique({
      where: { phase: 'FINAL' },
    });
    expect(before).toBeNull();

    // ── 1. Admin closes the FINAL match. The score matches the winner's
    //      prediction so the EXACT branch fires (5 × 5.0 = 25 pts).
    const finish = await request(h.app.getHttpServer())
      .post(`/admin/matches/${finalMatchId}/finish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 2, scoreAway: 1 });
    expect(finish.status).toBe(201);

    // ── 2. PhaseWinner exists for FINAL with the EXACT user winning.
    //      maybeClosePhase ran inside finishMatchAndScore — synchronous.
    const winner = await h.prisma.phaseWinner.findUnique({
      where: { phase: 'FINAL' },
    });
    expect(winner).not.toBeNull();
    expect(winner!.userId).toBe(winnerUserId);
    expect(winner!.pointsEarned).toBe(25);
    expect(winner!.prizeStatus).toBe('PENDING');

    // ── 3. Audit log `phase.closed` for entity=phase, entityId='FINAL'.
    const auditRow = await h.prisma.auditLog.findFirst({
      where: { action: 'phase.closed', entity: 'phase', entityId: 'FINAL' },
    });
    expect(auditRow).not.toBeNull();
    const changes = auditRow!.changes as {
      winner: { userId: string; points: number };
    };
    expect(changes.winner.userId).toBe(winnerUserId);
    expect(changes.winner.points).toBe(25);

    // ── 4. The `phase-winner` BullMQ job was enqueued. We can't easily
    //      observe a single in-flight job because the worker may have
    //      already consumed it; instead, look for the dedup'd
    //      Notification row that the processor writes (or, if the worker
    //      hasn't fired yet, accept the queue side). Either way, exactly
    //      one of the two artifacts must exist.
    const deadline = Date.now() + 5_000;
    let saw = false;
    while (Date.now() < deadline) {
      const notif = await h.prisma.notification.findUnique({
        where: { dedupKey: `phase-winner:FINAL:${winnerUserId}` },
      });
      if (notif) {
        saw = true;
        break;
      }
      const jobs = await queue.getJobs([
        'waiting',
        'active',
        'delayed',
        'completed',
      ]);
      if (jobs.some((j) => j.name === 'phase-winner')) {
        saw = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(saw).toBe(true);

    // ── 5. Re-triggering maybeClosePhase manually is idempotent — same
    //      PhaseWinner row, no second audit log written.
    const auditCountBefore = await h.prisma.auditLog.count({
      where: { action: 'phase.closed', entity: 'phase', entityId: 'FINAL' },
    });
    await phaseService.maybeClosePhase('FINAL');
    const auditCountAfter = await h.prisma.auditLog.count({
      where: { action: 'phase.closed', entity: 'phase', entityId: 'FINAL' },
    });
    expect(auditCountAfter).toBe(auditCountBefore);

    const winnerAfterRetry = await h.prisma.phaseWinner.findUnique({
      where: { phase: 'FINAL' },
    });
    expect(winnerAfterRetry!.id).toBe(winner!.id);
  }, 30_000);
});
