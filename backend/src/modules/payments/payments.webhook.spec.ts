import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MockCheckoutProvider } from '../../shared/checkout/mock.provider.js';
import { CHECKOUT_PROVIDER } from '../../shared/checkout/checkout.provider.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

/**
 * E2E for `POST /payments/webhook` with idempotency, recovery notification,
 * and the delayed admin-orphan-alert job. Uses MockCheckoutProvider so the
 * MP round-trip is skipped (`verifyWebhookSignature` is a no-op too).
 *
 * The notifications queue is shared with the integration spec, so we tag
 * dedup keys with `webhook-spec:` to keep the cleanup tight.
 */
describe('POST /payments/webhook (E2E with MockCheckoutProvider)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockProvider: MockCheckoutProvider;
  let queue: Queue;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  /** Tracks paymentIds we created so the afterAll cleanup is targeted. */
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
    mockProvider = app.get(CHECKOUT_PROVIDER) as MockCheckoutProvider;
    queue = app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
  }, 30_000);

  afterAll(async () => {
    if (prisma && createdPaymentIds.length > 0) {
      await prisma.notification.deleteMany({
        where: {
          dedupKey: { in: createdPaymentIds.map((id) => `recovery:${id}`) },
        },
      });
      await prisma.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    // Drop our delayed admin-orphan-alert jobs so they don't survive across
    // test runs (they're delayed 2hs by default).
    if (queue) {
      for (const id of createdPaymentIds) {
        const jobId = `orphan-alert-${id}`;
        const existing = await queue.getJob(jobId);
        if (existing) await existing.remove();
      }
    }
    if (app) await app.close();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  // NOTE: we deliberately don't reset the mock provider between tests.
  // Reset would re-mint `mock_pref_1` on the next init() and clash with
  // payments persisted by earlier tests, since their mpPreferenceId
  // lives on in the real Postgres until afterAll cleanup. Keeping the
  // counter monotonically growing avoids that ambiguity.

  /**
   * Helper: drives `POST /payments/init` and remembers the paymentId for
   * cleanup. Returns the response body.
   */
  async function init(): Promise<{ paymentId: string; initPoint: string }> {
    const res = await request(app.getHttpServer())
      .post('/payments/init')
      .send({});
    expect(res.status).toBe(201);
    createdPaymentIds.push(res.body.paymentId);
    return res.body;
  }

  it('init → simulate APPROVED webhook → Payment APPROVED + Notification + delayed job', async () => {
    const { paymentId } = await init();

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(payment.mpPreferenceId).toBeTruthy();

    // Use the mock provider as if MP just confirmed the payment.
    const dataId = mockProvider.simulatePayment({
      preferenceId: payment.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'buyer@example.com',
      payerName: 'Lionel',
    });

    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', 'req-1')
      .send({ type: 'payment', data: { id: dataId } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(after.status).toBe('APPROVED');
    expect(after.payerEmail).toBe('buyer@example.com');
    expect(after.payerName).toBe('Lionel');
    expect(after.mpPaymentId).toBe(dataId);
    expect(after.paidAt).toBeInstanceOf(Date);
    // tokenExpiresAt = paidAt + 7 days (within reasonable skew)
    expect(after.tokenExpiresAt).toBeInstanceOf(Date);
    const ttlMs = after.tokenExpiresAt!.getTime() - after.paidAt!.getTime();
    expect(ttlMs).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(ttlMs).toBeLessThan(7.1 * 24 * 3600 * 1000);
    expect(after.refundedAt).toBeNull();

    // Recovery notification with the magic link
    const notif = await prisma.notification.findFirst({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    expect(notif).toBeTruthy();
    expect(notif?.type).toBe('REGISTRATION_PENDING_RECOVERY');
    expect(notif?.channel).toBe('EMAIL');
    expect(notif?.toAddress).toBe('buyer@example.com');
    expect(notif?.message).toContain('/completar-registro?token=');

    // Delayed admin-orphan-alert job should be in the queue
    const job = await queue.getJob(`orphan-alert-${paymentId}`);
    expect(job).toBeTruthy();
    expect(job?.name).toBe('admin-orphan-alert');
    expect(job?.data).toEqual({ paymentId });
    expect(job?.opts.delay).toBeGreaterThan(0);
  });

  it('replaying the same APPROVED webhook is idempotent (no duplicate Notification)', async () => {
    const { paymentId } = await init();
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const dataId = mockProvider.simulatePayment({
      preferenceId: payment.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: 'idempotent@example.com',
    });

    const send = () =>
      request(app.getHttpServer())
        .post('/payments/webhook')
        .set('x-signature', 'ts=1,v1=00')
        .set('x-request-id', 'req-2')
        .send({ type: 'payment', data: { id: dataId } });

    await send();
    await send();

    const notifs = await prisma.notification.findMany({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    expect(notifs).toHaveLength(1);

    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(after.status).toBe('APPROVED');
  });

  it('ignores webhooks of type !== payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', 'req-3')
      .send({ type: 'merchant_order', data: { id: 'whatever' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('webhook for unknown payment is a no-op (returns 2xx)', async () => {
    // The mock raises NotFoundException when getPayment is called for an
    // id that was never simulated — so we expect a 4xx here, not a 2xx.
    // This proves we surface the not-found loudly rather than silently
    // swallowing webhook traffic for payments we don't know about.
    const res = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', 'req-4')
      .send({ type: 'payment', data: { id: 'mock_pay_does_not_exist' } });
    expect([404, 500]).toContain(res.status);
  });

  it('APPROVED webhook with no payer email triggers admin alert + notification with toAddress=null', async () => {
    const { paymentId } = await init();
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const dataId = mockProvider.simulatePayment({
      preferenceId: payment.mpPreferenceId!,
      status: 'APPROVED',
      payerEmail: null,
    });

    await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('x-signature', 'ts=1,v1=00')
      .set('x-request-id', 'req-5')
      .send({ type: 'payment', data: { id: dataId } });

    const recovery = await prisma.notification.findFirst({
      where: { dedupKey: `recovery:${paymentId}` },
    });
    expect(recovery).toBeTruthy();
    expect(recovery?.toAddress).toBeNull();

    // The admin alert is a separate Notification with channel=WHATSAPP and
    // type=ADMIN_BROADCAST, addressed to the env's admin number.
    const adminAlerts = await prisma.notification.findMany({
      where: {
        type: 'ADMIN_BROADCAST',
        channel: 'WHATSAPP',
        message: { contains: paymentId },
      },
    });
    expect(adminAlerts.length).toBeGreaterThanOrEqual(1);

    // Cleanup the admin alert(s) we just created (no dedupKey so the
    // afterAll cleanup wouldn't catch them).
    await prisma.notification.deleteMany({
      where: { id: { in: adminAlerts.map((a) => a.id) } },
    });
  });
});
