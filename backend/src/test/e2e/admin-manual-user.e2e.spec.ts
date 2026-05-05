import request from 'supertest';
import {
  ADMIN_LOGIN,
  createE2EApp,
  uniqueDni,
  uniqueWhatsapp,
  type E2EAppHandles,
} from '../helpers/e2e-app.js';

/**
 * Spec section 10 — E2E flow #4: admin-manual user.
 *
 * The cash/transfer registration path skips MercadoPago entirely. The
 * admin creates the User and a paired APPROVED Payment in one shot;
 * downstream features (auth, predictions) must treat the manually-created
 * user identically to a publicly-registered one.
 *
 * What the test covers:
 *   1. Admin login via the seeded credentials.
 *   2. POST /admin/users with method='CASH' creates User + Payment +
 *      audit row in one TX.
 *   3. The new user can log in via /auth/login (DNI + the password the
 *      admin typed).
 *   4. The new user can POST a prediction immediately — proving the user
 *      isn't second-class.
 *   5. The endpoint rejects ADMIN-less callers (USER role from a public
 *      registration → 403).
 */
describe('E2E flow #4: admin manual user creation', () => {
  let h: E2EAppHandles;
  let adminToken: string;
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

    const adminLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send(ADMIN_LOGIN);
    if (adminLogin.status !== 200) {
      throw new Error(
        `Admin login failed (status ${adminLogin.status}). Run Phase 2 seed.`,
      );
    }
    adminToken = adminLogin.body.accessToken;

    // We'll need an open match for the prediction step. Use matchNumber 67
    // (free per the audit at the top of `prediction-scoring.e2e.spec.ts`).
    const match = await h.prisma.match.findFirstOrThrow({
      where: { matchNumber: 67 },
    });
    matchId = match.id;
    matchSnapshot = {
      status: match.status,
      scoreHome: match.scoreHome,
      scoreAway: match.scoreAway,
      finishedAt: match.finishedAt,
      predictionsLockAt: match.predictionsLockAt,
    };
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
  }, 60_000);

  afterAll(async () => {
    if (h?.prisma) {
      if (matchId) {
        await h.prisma.prediction.deleteMany({ where: { matchId } });
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

  it('admin creates manual user → user logs in → user predicts → audit row written', async () => {
    const dni = uniqueDni();
    const whatsapp = uniqueWhatsapp();
    const password = 'manual-pass1!';

    // ── 1. POST /admin/users (cash, 15000 ARS).
    const createRes = await request(h.app.getHttpServer())
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dni,
        firstName: 'Manual',
        lastName: 'User',
        whatsapp,
        password,
        paymentMethod: 'CASH',
        amount: 15_000,
        receivedBy: 'Test Cashier',
        notes: 'Sobre #42',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.user.dni).toBe(dni);
    expect(createRes.body.user.role).toBe('USER');
    expect(createRes.body.user.status).toBe('ACTIVE');
    expect(createRes.body.payment.method).toBe('CASH');
    expect(createRes.body.payment.status).toBe('APPROVED');
    expect(createRes.body.payment.amount).toBe(15_000);
    const newUserId: string = createRes.body.user.id;

    // ── 2. Both rows landed in the same TX with the expected fields.
    const userRow = await h.prisma.user.findUniqueOrThrow({ where: { dni } });
    expect(userRow.role).toBe('USER');
    expect(userRow.status).toBe('ACTIVE');
    expect(userRow.passwordHash).not.toEqual(password); // bcrypt'd

    const paymentRow = await h.prisma.payment.findFirstOrThrow({
      where: { userId: newUserId },
    });
    expect(paymentRow.method).toBe('CASH');
    expect(paymentRow.status).toBe('APPROVED');
    expect(Number(paymentRow.amount)).toBe(15_000);
    expect(paymentRow.paidAt).toBeInstanceOf(Date);
    expect(paymentRow.completedAt).toBeInstanceOf(Date);
    expect(paymentRow.completionTokenHash).toBeNull();
    expect(paymentRow.receivedBy).toBe('Test Cashier');
    expect(paymentRow.notes).toBe('Sobre #42');

    // ── 3. Audit row records the action with masked DNI + payment id.
    const auditRow = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.created_manually', entityId: newUserId },
    });
    expect(auditRow.entity).toBe('user');
    const changes = auditRow.changes as {
      dni: string;
      paymentId: string;
      paymentMethod: string;
      amount: number;
    };
    expect(changes.paymentMethod).toBe('CASH');
    expect(changes.amount).toBe(15_000);
    expect(changes.paymentId).toBe(paymentRow.id);
    // DNI is masked (`12***678`), not raw, so the audit log can't be a
    // PII leak channel.
    expect(changes.dni).not.toBe(dni);
    expect(changes.dni.startsWith(dni.slice(0, 2))).toBe(true);

    // ── 4. The new user authenticates with their DNI + password.
    const loginRes = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.dni).toBe(dni);
    expect(loginRes.body.user.role).toBe('USER');
    const userToken: string = loginRes.body.accessToken;

    // ── 5. The new user posts a prediction, proving they're not a
    //      second-class citizen of the platform.
    const predictRes = await request(h.app.getHttpServer())
      .post(`/predictions/match/${matchId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scoreHome: 1, scoreAway: 0 });
    expect(predictRes.status).toBe(201);
    expect(predictRes.body.matchId).toBe(matchId);

    // ── 6. The same DNI from a USER token is rejected (RolesGuard 403).
    const forbid = await request(h.app.getHttpServer())
      .post('/admin/users')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        dni: uniqueDni(),
        firstName: 'Should',
        lastName: 'Fail',
        whatsapp: uniqueWhatsapp(),
        password: 'whatever1',
        paymentMethod: 'CASH',
        amount: 15_000,
      });
    expect(forbid.status).toBe(403);
  }, 30_000);

  it('duplicate DNI on manual creation → 409 DNI_ALREADY_EXISTS', async () => {
    const dni = uniqueDni();
    const whatsapp = uniqueWhatsapp();
    const ok = await request(h.app.getHttpServer())
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dni,
        firstName: 'Original',
        lastName: 'User',
        whatsapp,
        password: 'pass-1234',
        paymentMethod: 'TRANSFER',
        amount: 15_000,
      });
    expect(ok.status).toBe(201);

    const dup = await request(h.app.getHttpServer())
      .post('/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dni, // same DNI
        firstName: 'Dup',
        lastName: 'Attempt',
        whatsapp: uniqueWhatsapp(),
        password: 'pass-1234',
        paymentMethod: 'CASH',
        amount: 15_000,
      });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DNI_ALREADY_EXISTS');
  }, 30_000);
});
