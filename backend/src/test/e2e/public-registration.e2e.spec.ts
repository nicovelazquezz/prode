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

/**
 * Spec section 10 — E2E flow #1: public registration.
 *
 * Walks one anonymous visitor from `POST /payments/init` through the
 * MercadoPago mock, the magic-link recovery email, the registration form,
 * and finally a fresh login round-trip. The intent is to prove the *whole*
 * pipeline composes — payments + auth + notifications + audit + the
 * delayed BullMQ orphan-alert job.
 *
 * Each existing module already has its own integration test for these
 * pieces; this suite is the safety net for the seams between them.
 */
describe('E2E flow #1: public registration', () => {
  let h: E2EAppHandles;
  let queue: Queue;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    h = await createE2EApp();
    queue = h.app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
    // Wipe all user-domain rows but keep the seeded admin so /auth/login
    // works for downstream sanity checks.
    await h.cleanDb();
    // Give the BullMQ worker a beat to attach its blocking listener so
    // jobs we add survive past the suite (we don't want the worker to
    // grab and execute the delayed orphan-alert mid-test).
    await new Promise((r) => setTimeout(r, 1500));
  }, 60_000);

  afterAll(async () => {
    if (h?.prisma) {
      // Drop any delayed orphan-alert jobs we may have produced so they
      // don't survive into other suites' BullMQ state.
      const jobs = await queue.getJobs(['delayed', 'waiting']);
      for (const j of jobs) {
        if (j.name === 'admin-orphan-alert') {
          await j.remove().catch(() => undefined);
        }
      }
      await h.cleanDb();
    }
    if (h?.closeApp) await h.closeApp();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  it('init payment → webhook approved → complete registration → login → authenticated read', async () => {
    // ── 1. POST /payments/init ──────────────────────────────────────────
    const initRes = await request(h.app.getHttpServer())
      .post('/payments/init')
      .send({});
    expect(initRes.status).toBe(201);
    const paymentId: string = initRes.body.paymentId;
    expect(typeof paymentId).toBe('string');
    expect(typeof initRes.body.initPoint).toBe('string');
    expect(initRes.body.initPoint).toMatch(/^https:\/\/mock\.local\//);

    // The Payment is PENDING with a preferenceId set.
    const pendingPayment = await h.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(pendingPayment.status).toBe('PENDING');
    expect(pendingPayment.mpPreferenceId).not.toBeNull();
    expect(pendingPayment.completedAt).toBeNull();
    expect(pendingPayment.completionTokenHash).not.toBeNull();

    // ── 2. mockProvider.simulatePayment APPROVED + 3. webhook ───────────
    const dataId = h.mockProvider.simulatePayment({
      preferenceId: pendingPayment.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'e2e-flow1@example.com',
      payerName: 'Diego',
    });

    const webhookRes = await request(h.app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', `req-${paymentId}`)
      .send({ type: 'payment', data: { id: dataId } });
    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body).toEqual({ received: true });

    // ── 4. Verify side-effects of the APPROVED transition ───────────────
    const approvedPayment = await h.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(approvedPayment.status).toBe('APPROVED');
    expect(approvedPayment.payerEmail).toBe('e2e-flow1@example.com');
    expect(approvedPayment.paidAt).toBeInstanceOf(Date);
    expect(approvedPayment.tokenExpiresAt).toBeInstanceOf(Date);
    expect(approvedPayment.completedAt).toBeNull();

    // Recovery notification was created with the magic link.
    const recoveryNotif = await h.prisma.notification.findFirstOrThrow({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    expect(recoveryNotif.type).toBe('REGISTRATION_PENDING_RECOVERY');
    expect(recoveryNotif.status).toBe('PENDING');
    expect(recoveryNotif.toAddress).toBe('e2e-flow1@example.com');
    const tokenMatch = recoveryNotif.message.match(/token=([0-9a-f]+)/);
    expect(tokenMatch).not.toBeNull();
    const plainToken = tokenMatch![1];

    // The delayed orphan-alert job was queued (jobId is the dedup key).
    const orphanJob = await queue.getJob(
      `orphan-alert-${paymentId.replace(/:/g, '_')}`,
    );
    expect(orphanJob).not.toBeUndefined();
    expect(orphanJob!.name).toBe('admin-orphan-alert');

    // ── 5. POST /auth/complete-registration ─────────────────────────────
    const dni = uniqueDni();
    const whatsapp = uniqueWhatsapp();
    const completeRes = await request(h.app.getHttpServer())
      .post('/auth/complete-registration')
      .send({
        token: plainToken,
        dni,
        firstName: 'E2E',
        lastName: 'Tester',
        whatsapp,
        password: 'e2e-flow1-pass1!',
      });
    expect(completeRes.status).toBe(200);
    const accessTokenAfterRegistration: string = completeRes.body.accessToken;
    expect(typeof accessTokenAfterRegistration).toBe('string');

    // ── 6. Verify User created + Payment linked + completedAt set ───────
    const created = await h.prisma.user.findUniqueOrThrow({ where: { dni } });
    expect(created.firstName).toBe('E2E');
    expect(created.role).toBe('USER');
    expect(created.status).toBe('ACTIVE');

    const linkedPayment = await h.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(linkedPayment.userId).toBe(created.id);
    expect(linkedPayment.completedAt).toBeInstanceOf(Date);

    // ── 7. POST /auth/login with the new DNI + password → fresh token ───
    const loginRes = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password: 'e2e-flow1-pass1!' });
    expect(loginRes.status).toBe(200);
    expect(typeof loginRes.body.accessToken).toBe('string');
    expect(loginRes.body.user.dni).toBe(dni);
    expect(loginRes.body.user.role).toBe('USER');
    const accessTokenAfterLogin: string = loginRes.body.accessToken;

    // ── 8. Authenticated read with bearer token → 200 ──────────────────
    // Use /predictions/me as the equivalent of `auth/me` — it's the only
    // user-scoped GET that the JwtAuthGuard protects without requiring
    // the user to have already POSTed something.
    const meRes = await request(h.app.getHttpServer())
      .get('/predictions/me')
      .set('Authorization', `Bearer ${accessTokenAfterLogin}`);
    expect(meRes.status).toBe(200);
    expect(Array.isArray(meRes.body.data)).toBe(true);
    expect(meRes.body.data.length).toBe(0);

    // The seeded admin still authenticates with their own credentials —
    // proves cleanDb didn't accidentally wipe them.
    const adminLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send(ADMIN_LOGIN);
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.user.role).toBe('ADMIN');
  }, 30_000);
});
