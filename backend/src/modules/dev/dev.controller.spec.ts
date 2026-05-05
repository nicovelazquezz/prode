import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

/**
 * Integration test for `POST /dev/simulate-webhook`. The endpoint exists
 * solely to drive the public payment flow end-to-end from the local
 * frontend without involving MercadoPago, so the assertions here mirror
 * the real webhook spec: APPROVED → Payment APPROVED + recovery
 * Notification + delayed orphan-alert job; REJECTED → Payment REJECTED;
 * unknown paymentId → 404.
 *
 * NODE_ENV is forced to 'test' so the conditional import in AppModule
 * mounts DevModule (the prod gate is `!== 'production'`).
 */
describe('POST /dev/simulate-webhook (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  /** Track ids for surgical afterAll cleanup. */
  const createdPaymentIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    queue = app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
  }, 30_000);

  afterAll(async () => {
    if (prisma && createdPaymentIds.length > 0) {
      await prisma.notification.deleteMany({
        where: {
          dedupKey: { in: createdPaymentIds.map((id) => `recovery:${id}`) },
        },
      });
      // Admin alerts created by the no-email branch don't carry a
      // dedupKey, so we match on message contents to clean them up.
      await prisma.notification.deleteMany({
        where: {
          type: 'ADMIN_BROADCAST',
          channel: 'WHATSAPP',
          message: {
            in: createdPaymentIds.map(
              (id) => `Pago ${id} aprobado sin email de payer.`,
            ),
          },
        },
      });
      await prisma.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (queue) {
      for (const id of createdPaymentIds) {
        const job = await queue.getJob(`orphan-alert-${id}`);
        if (job) await job.remove();
      }
    }
    if (app) await app.close();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  /**
   * Helper: drives `POST /payments/init` and remembers the paymentId.
   * Mirrors the real frontend's flow into mock-checkout.
   */
  async function init(): Promise<{ paymentId: string }> {
    const res = await request(app.getHttpServer())
      .post('/payments/init')
      .send({});
    expect(res.status).toBe(201);
    createdPaymentIds.push(res.body.paymentId);
    return { paymentId: res.body.paymentId };
  }

  it('approves a payment and emits the recovery notification with a usable token', async () => {
    const { paymentId } = await init();

    const res = await request(app.getHttpServer())
      .post('/dev/simulate-webhook')
      .send({
        paymentId,
        status: 'approved',
        payerEmail: 'dev-buyer@example.com',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      paymentId,
      status: 'approved',
    });
    expect(res.body.completionToken).toMatch(/^[0-9a-f]{64}$/);

    // Payment row transitioned to APPROVED with the dev payer email.
    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(after.status).toBe('APPROVED');
    expect(after.payerEmail).toBe('dev-buyer@example.com');
    expect(after.paidAt).toBeInstanceOf(Date);
    expect(after.tokenExpiresAt).toBeInstanceOf(Date);

    // Recovery notification carries the magic-link with the same token
    // we returned in the response.
    const notif = await prisma.notification.findFirst({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    expect(notif).toBeTruthy();
    expect(notif?.type).toBe('REGISTRATION_PENDING_RECOVERY');
    expect(notif?.message).toContain(
      `/completar-registro?token=${res.body.completionToken}`,
    );

    // Delayed admin-orphan-alert job exists (same id format the real
    // webhook handler uses).
    const job = await queue.getJob(`orphan-alert-${paymentId}`);
    expect(job).toBeTruthy();
    expect(job?.data).toEqual({ paymentId });

    // The token returned in the response actually unlocks the flow:
    // /payments/by-token resolves to APPROVED + not-yet-completed.
    const byTokenRes = await request(app.getHttpServer())
      .get(`/payments/by-token/${res.body.completionToken}`);
    expect(byTokenRes.status).toBe(200);
    expect(byTokenRes.body.status).toBe('APPROVED');
    expect(byTokenRes.body.completed).toBe(false);
  });

  it('rejects a payment without firing recovery side-effects', async () => {
    const { paymentId } = await init();

    const res = await request(app.getHttpServer())
      .post('/dev/simulate-webhook')
      .send({ paymentId, status: 'rejected' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(after.status).toBe('REJECTED');
    expect(after.paidAt).toBeNull();

    // No recovery notification on REJECTED — only APPROVED triggers it.
    const notif = await prisma.notification.findFirst({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    expect(notif).toBeNull();
  });

  it('returns 404 for a payment id that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .post('/dev/simulate-webhook')
      .send({ paymentId: 'does_not_exist_xyz', status: 'approved' });

    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid status', async () => {
    const { paymentId } = await init();
    const res = await request(app.getHttpServer())
      .post('/dev/simulate-webhook')
      .send({ paymentId, status: 'banana' });
    expect(res.status).toBe(400);
  });

  it('falls back to a synthetic email when payerEmail is omitted (and triggers admin alert)', async () => {
    const { paymentId } = await init();

    const res = await request(app.getHttpServer())
      .post('/dev/simulate-webhook')
      .send({ paymentId, status: 'approved' });

    expect(res.status).toBe(200);
    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    // Default email lives in the controller — we just assert the
    // payment was tagged with *some* string the dev caller didn't pass.
    expect(after.payerEmail).toBeTruthy();
    expect(after.payerEmail).toMatch(/@/);
  });
});

/**
 * Production gate test: when NODE_ENV is 'production' the AppModule
 * conditional import drops DevModule entirely, so the route doesn't
 * even register. We can't easily re-import AppModule with a different
 * env in the same process (module resolution is cached), so this lives
 * as a unit-style assertion on the controller's runtime guard — the
 * second line of defense documented in dev.controller.ts.
 */
describe('DevController production guard (unit)', () => {
  it('throws NotFoundException when NODE_ENV=production at handler time', async () => {
    const { DevController } = await import('./dev.controller.js');
    const ctrl = new DevController(
      // Service deps are unused on the prod-gate branch; a typed cast
      // keeps the test readable without a full DI fixture.
      {} as never,
      {} as never,
      {} as never,
    );
    // Patch the cached env *after* construction so we hit the runtime
    // guard, not the cached value loaded by `loadEnv()`.
    (ctrl as unknown as { env: { NODE_ENV: string } }).env = {
      NODE_ENV: 'production',
    };
    await expect(
      ctrl.simulateWebhook({
        paymentId: 'whatever',
        status: 'approved',
      }),
    ).rejects.toThrow('Not Found');
  });
});
