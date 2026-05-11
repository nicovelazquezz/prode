import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MockCheckoutProvider } from '../../shared/checkout/mock.provider.js';
import { CHECKOUT_PROVIDER } from '../../shared/checkout/checkout.provider.js';

/**
 * End-to-end happy + lock paths for Phase 7 (Task 7.7).
 *
 * Mirrors the flow the spec promises a real user goes through:
 *   1. POST /payments/init → mock APPROVED webhook → POST /auth/complete-registration
 *      → JWT in hand.
 *   2. POST /predictions/match/:id → 201 with the prediction.
 *   3. GET /predictions/me → response includes the prediction.
 *   4. We simulate kickoff by pushing predictionsLockAt into the past.
 *   5. PUT /predictions/match/:id → 400 PREDICTION_LOCKED.
 *
 * NODE_ENV is forced to 'test' so the CheckoutModule binds the mock —
 * matches how `complete-registration.spec.ts` is configured.
 */
describe('Predictions E2E (registration → predict → lock)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockProvider: MockCheckoutProvider;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  // Track everything we create so afterAll can clean up surgically.
  const createdPaymentIds: string[] = [];
  const createdUserIds: string[] = [];
  const matchSnapshots: Array<{ id: string; lockAt: Date }> = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    mockProvider = app.get(CHECKOUT_PROVIDER) as MockCheckoutProvider;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Restore match locks first so future runs see the seed values.
      for (const snap of matchSnapshots) {
        await prisma.match
          .update({
            where: { id: snap.id },
            data: { predictionsLockAt: snap.lockAt },
          })
          .catch(() => undefined);
      }
      // Multi-prode: predictions cascade off entries, entries cascade
      // off users. Delete users first; payments must come AFTER because
      // Entry.paymentId is ON DELETE RESTRICT.
      if (createdUserIds.length > 0) {
        await prisma.refreshToken.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.auditLog.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
      if (createdPaymentIds.length > 0) {
        await prisma.notification.deleteMany({
          where: {
            dedupKey: { in: createdPaymentIds.map((id) => `recovery:${id}`) },
          },
        });
        await prisma.payment.deleteMany({
          where: { id: { in: createdPaymentIds } },
        });
      }
    }
    if (app) await app.close();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  /**
   * Drives init + simulate-webhook and returns the magic-link token. Lifted
   * verbatim from `complete-registration.spec.ts` (changing it once should
   * change it everywhere — but the suites stay independent for now to avoid
   * coupling).
   */
  async function paidPayment(): Promise<{
    paymentId: string;
    plainToken: string;
  }> {
    const initRes = await request(app.getHttpServer())
      .post('/payments/init')
      .send({});
    expect(initRes.status).toBe(201);
    const paymentId: string = initRes.body.paymentId;
    createdPaymentIds.push(paymentId);

    const local = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const dataId = mockProvider.simulatePayment({
      preferenceId: local.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'predict-e2e@example.com',
      payerName: 'Diego',
    });

    const webhookRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', `req-${paymentId}`)
      .send({ type: 'payment', data: { id: dataId } });
    expect(webhookRes.status).toBe(200);

    const notif = await prisma.notification.findFirstOrThrow({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    const m = notif.message.match(/token=([0-9a-f]+)/);
    if (!m) throw new Error('Magic link token not found in notification');
    return { paymentId, plainToken: m[1] };
  }

  function uniqueDni(): string {
    const n = (Date.now() + Math.floor(Math.random() * 1000)) % 90_000_000;
    return String(50_000_000 + n).slice(-8);
  }

  function uniqueWa(): string {
    const n = (Date.now() + Math.floor(Math.random() * 1000)) % 1_000_000_000;
    return `549${String(5_000_000_000 + n).slice(-9)}`.slice(0, 13);
  }

  it('walks the full path: register → predict → list → lock → fail', async () => {
    // ── 1. Public registration via the mock checkout provider ─────────
    const { plainToken } = await paidPayment();
    const dni = uniqueDni();
    const whatsapp = uniqueWa();

    const completeRes = await request(app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: plainToken,
        dni,
        firstName: 'E2E',
        lastName: 'Predictor',
        whatsapp,
        password: 'e2e-predict-pass-1!',
      });
    expect(completeRes.status).toBe(200);
    const accessToken: string = completeRes.body.accessToken;
    expect(typeof accessToken).toBe('string');

    const created = await prisma.user.findUniqueOrThrow({ where: { dni } });
    createdUserIds.push(created.id);

    // ── 2. POST /predictions/match/:id → 201 ──────────────────────────
    // Pick a match the other prediction suites don't touch (104 matches in
    // total per seed; 95 is in QUARTERS and far from the 80/81/82/90/100/
    // 101 the other tests use).
    const target = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 95 },
    });
    matchSnapshots.push({ id: target.id, lockAt: target.predictionsLockAt });

    // Defensive: if the seed put this match's lock in the past, push it
    // forward so the POST succeeds.
    if (target.predictionsLockAt.getTime() <= Date.now()) {
      await prisma.match.update({
        where: { id: target.id },
        data: {
          predictionsLockAt: new Date(Date.now() + 6 * 3600 * 1000),
        },
      });
    }

    const post = await request(app.getHttpServer())
      .post(`/predictions/match/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ scoreHome: 3, scoreAway: 2 });
    expect(post.status).toBe(201);
    expect(post.body.matchId).toBe(target.id);
    expect(post.body.scoreHome).toBe(3);
    expect(post.body.scoreAway).toBe(2);

    // ── 3. GET /predictions/me includes the prediction ────────────────
    const list = await request(app.getHttpServer())
      .get('/predictions/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    const found = (list.body.data as Array<{ matchId: string }>).find(
      (p) => p.matchId === target.id,
    );
    expect(found).toBeDefined();

    // ── 4. Trigger the lock manually (simulate kickoff happened) ──────
    await prisma.match.update({
      where: { id: target.id },
      data: { predictionsLockAt: new Date(Date.now() - 60_000) },
    });

    // ── 5. PUT after lock → 400 PREDICTION_LOCKED ─────────────────────
    const put = await request(app.getHttpServer())
      .put(`/predictions/match/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ scoreHome: 4, scoreAway: 0 });
    expect(put.status).toBe(400);
    expect(put.body.code).toBe('PREDICTION_LOCKED');

    // The original prediction is unchanged. Multi-prode: query by the
    // user's primary entry (created automatically at registration).
    const entry = await prisma.entry.findFirstOrThrow({
      where: { userId: created.id, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
    });
    const inDb = await prisma.prediction.findUniqueOrThrow({
      where: { entryId_matchId: { entryId: entry.id, matchId: target.id } },
    });
    expect(inDb.scoreHome).toBe(3);
    expect(inDb.scoreAway).toBe(2);
  }, 30_000);
});
