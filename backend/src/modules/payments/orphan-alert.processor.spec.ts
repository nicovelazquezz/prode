import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import {
  OrphanAlertProcessor,
  type OrphanAlertJobData,
} from './orphan-alert.processor.js';

/**
 * Synthesises a minimal `Job` shim so we can call `OrphanAlertProcessor.handle`
 * without spinning up BullMQ. We only depend on `data` and `id`; everything
 * else BullMQ provides is unused by the handler.
 */
function makeJob(paymentId: string): Job<OrphanAlertJobData> {
  return {
    id: `test-${paymentId}`,
    data: { paymentId },
  } as unknown as Job<OrphanAlertJobData>;
}

describe('OrphanAlertProcessor (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let processor: OrphanAlertProcessor;
  const createdPaymentIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    processor = app.get(OrphanAlertProcessor);
  }, 30_000);

  afterAll(async () => {
    if (prisma && createdPaymentIds.length > 0) {
      await prisma.notification.deleteMany({
        where: {
          dedupKey: {
            in: createdPaymentIds.map((id) => `orphan-alert-fired:${id}`),
          },
        },
      });
      await prisma.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (app) await app.close();
  }, 30_000);

  async function makeApprovedPayment(opts: {
    completedAt?: Date | null;
    payerEmail?: string | null;
  } = {}): Promise<string> {
    const p = await prisma.payment.create({
      data: {
        userId: null,
        amount: 15_000,
        method: 'MERCADOPAGO',
        status: 'APPROVED',
        completionTokenHash: auth.hashToken(
          `orphan-alert-${Math.random()}-${Date.now()}`,
        ),
        tokenExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        paidAt: new Date(),
        completedAt: opts.completedAt ?? null,
        payerEmail: opts.payerEmail ?? 'late@example.com',
      },
    });
    createdPaymentIds.push(p.id);
    return p.id;
  }

  it('fires admin alert when payment is APPROVED + completedAt is null', async () => {
    const id = await makeApprovedPayment();
    const fired = await processor.handle(makeJob(id));
    expect(fired).toBe(true);

    // The alert lands as a Notification with the dedup key we set.
    const alert = await prisma.notification.findUnique({
      where: { dedupKey: `orphan-alert-fired:${id}` },
    });
    expect(alert).toBeTruthy();
    expect(alert?.channel).toBe('WHATSAPP');
    expect(alert?.message).toContain(id);
  });

  it('skips when payment already has completedAt set', async () => {
    const id = await makeApprovedPayment({ completedAt: new Date() });
    const fired = await processor.handle(makeJob(id));
    expect(fired).toBe(false);

    const alert = await prisma.notification.findUnique({
      where: { dedupKey: `orphan-alert-fired:${id}` },
    });
    expect(alert).toBeNull();
  });

  it('skips when payment is missing', async () => {
    const fired = await processor.handle(makeJob('nonexistent_id_xyz'));
    expect(fired).toBe(false);
  });
});
