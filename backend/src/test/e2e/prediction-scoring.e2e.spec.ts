import request from 'supertest';
import {
  ADMIN_LOGIN,
  createE2EApp,
  uniqueDni,
  uniqueWhatsapp,
  type E2EAppHandles,
} from '../helpers/e2e-app.js';

/**
 * Spec section 10 — E2E flow #2: prediction + scoring.
 *
 * Walks the path a real user takes after registration:
 *
 *   register → login → POST a prediction → admin finishes the match →
 *   leaderboard.refresh worker fires → user re-reads /predictions/me and
 *   sees the points → /leaderboard/global reflects them.
 *
 * The seam under test is the chain
 *   ScoringService.finishMatchAndScore  →
 *   classifyOutcome (EXACT branch)       →
 *   notifications queue (`leaderboard.refresh` + `match-result`) →
 *   LeaderboardRefreshProcessor          →
 *   `REFRESH MATERIALIZED VIEW` + cache invalidate →
 *   /leaderboard/global cache miss with the new value.
 */
describe('E2E flow #2: prediction → admin finish → scoring → leaderboard', () => {
  let h: E2EAppHandles;
  let userToken: string;
  let userId: string;
  let adminToken: string;
  let matchId: string;
  // Snapshot so afterAll restores the seed state for matches we touched.
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

    // Pick a GROUPS-phase match no other suite touches (66 is free per
    // the matchNumber audit at the top of this file's git blame). The
    // seed has 48 GROUPS matches in total — finishing one of them keeps
    // the phase pending so PhaseService.maybeClosePhase short-circuits.
    const match = await h.prisma.match.findFirstOrThrow({
      where: { matchNumber: 66 },
    });
    matchId = match.id;
    matchSnapshot = {
      status: match.status,
      scoreHome: match.scoreHome,
      scoreAway: match.scoreAway,
      finishedAt: match.finishedAt,
      predictionsLockAt: match.predictionsLockAt,
    };
    // Defensive reset: if a previous run left this match FINISHED (e.g.
    // the suite crashed mid-test), put it back to SCHEDULED so the
    // /admin/.../finish call works.
    await h.prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'SCHEDULED',
        scoreHome: null,
        scoreAway: null,
        finishedAt: null,
        // Push the lock window into the future so POST /predictions/match
        // can write before the admin closes it.
        predictionsLockAt: new Date(Date.now() + 6 * 3600 * 1000),
      },
    });

    // Register one user via the public flow; this also exercises the
    // payment + magic-link path one more time, which is fine — we want
    // every E2E spec to be independently runnable from a clean DB.
    const initRes = await request(h.app.getHttpServer())
      .post('/payments/init')
      .send({});
    const paymentId: string = initRes.body.paymentId;
    const local = await h.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const dataId = h.mockProvider.simulatePayment({
      preferenceId: local.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'flow2@example.com',
      payerName: 'Lionel',
    });
    await request(h.app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', `req-${paymentId}`)
      .send({ type: 'payment', data: { id: dataId } });
    const notif = await h.prisma.notification.findFirstOrThrow({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    const plainToken = notif.message.match(/token=([0-9a-f]+)/)![1];
    const dni = uniqueDni();
    const whatsapp = uniqueWhatsapp();
    const completeRes = await request(h.app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: plainToken,
        dni,
        firstName: 'Flow2',
        lastName: 'User',
        whatsapp,
        password: 'flow2-pass-1!',
      });
    userToken = completeRes.body.accessToken;
    userId = completeRes.body.user.id;

    // Admin login.
    const adminLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send(ADMIN_LOGIN);
    adminToken = adminLogin.body.accessToken;

    // Give the BullMQ worker a beat to attach its blocking listener so
    // `leaderboard.refresh` is processed (not stuck waiting for a worker
    // that isn't ready yet).
    await new Promise((r) => setTimeout(r, 1500));
  }, 60_000);

  afterAll(async () => {
    if (h?.prisma && matchId) {
      await h.prisma.prediction.deleteMany({ where: { matchId } });
      await h.prisma.auditLog.deleteMany({
        where: { entity: 'match', entityId: matchId },
      });
      await h.prisma.match.update({
        where: { id: matchId },
        data: matchSnapshot,
      });
    }
    if (h?.prisma) {
      await h.cleanDb();
      // Final MV refresh so the test user's row leaves leaderboard_global
      // before the next suite starts polling it.
      await h.prisma
        .$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
    }
    if (h?.closeApp) await h.closeApp();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  it('user predicts → admin finishes match exact → user sees 5 pts in leaderboard', async () => {
    // ── 1. POST a prediction with the EXACT score we'll later finalise.
    const post = await request(h.app.getHttpServer())
      .post(`/predictions/match/${matchId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scoreHome: 2, scoreAway: 1 });
    expect(post.status).toBe(201);
    expect(post.body.matchId).toBe(matchId);

    // ── 2. /predictions/me has the row, no points yet (not evaluated).
    const beforeFinish = await request(h.app.getHttpServer())
      .get('/predictions/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(beforeFinish.status).toBe(200);
    const beforeRow = (
      beforeFinish.body.data as Array<{
        matchId: string;
        pointsEarned: number | null;
        outcomeType: string | null;
        evaluatedAt: string | null;
      }>
    ).find((p) => p.matchId === matchId);
    expect(beforeRow).toBeDefined();
    // Schema defaults: `pointsEarned` is Int default 0, `outcomeType` is
    // nullable OutcomeType?, `evaluatedAt` is nullable DateTime. The
    // un-evaluated row therefore reads 0 / null / null — that combination
    // is what tells us scoring hasn't run yet.
    expect(beforeRow!.pointsEarned).toBe(0);
    expect(beforeRow!.outcomeType).toBeNull();
    expect(beforeRow!.evaluatedAt).toBeNull();

    // ── 3. Admin finishes the match 2-1 (matches our prediction → EXACT).
    const finish = await request(h.app.getHttpServer())
      .post(`/admin/matches/${matchId}/finish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 2, scoreAway: 1 });
    expect(finish.status).toBe(201);

    // ── 4. The scoring TX itself wrote pointsEarned=5 (5 base x 1.0
    //      GROUPS multiplier) before returning. Confirm via /predictions/me.
    const afterFinish = await request(h.app.getHttpServer())
      .get('/predictions/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(afterFinish.status).toBe(200);
    const afterRow = (
      afterFinish.body.data as Array<{
        matchId: string;
        pointsEarned: number | null;
        outcomeType: string | null;
      }>
    ).find((p) => p.matchId === matchId);
    expect(afterRow).toBeDefined();
    expect(afterRow!.pointsEarned).toBe(5);
    expect(afterRow!.outcomeType).toBe('EXACT');

    // ── 5. Wait for the BullMQ worker to refresh leaderboard_global +
    //      drop the cache key. Multi-prode: MV is keyed by entry_id.
    //      Resolve the user's primary entry first.
    const userEntry = await h.prisma.entry.findFirstOrThrow({
      where: { userId, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
    });
    const deadline = Date.now() + 10_000;
    let mvPoints = 0;
    while (Date.now() < deadline) {
      const rows = await h.prisma.$queryRaw<Array<{ total_points: bigint }>>`
        SELECT total_points FROM leaderboard_global WHERE entry_id = ${userEntry.id}
      `;
      mvPoints = Number(rows[0]?.total_points ?? 0n);
      if (mvPoints === 5) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(mvPoints).toBe(5);

    // ── 6. Public /leaderboard/global reflects the entry's 5 pts.
    const lb = await request(h.app.getHttpServer()).get(
      '/leaderboard/global',
    );
    expect(lb.status).toBe(200);
    const me = (
      lb.body.rows as Array<{ entry_id: string; total_points: number }>
    ).find((r) => r.entry_id === userEntry.id);
    expect(me).toBeDefined();
    expect(me!.total_points).toBe(5);
  }, 30_000);
});
