import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PaymentsCron } from './payments.cron.js';

/**
 * Integration test for `PaymentsCron.cleanupOrphanedPayments`. We don't
 * exercise the actual cron trigger (Nest's scheduler would only fire
 * at 3am ART) — instead we call the method directly, which is the
 * pattern the plan prescribes for cron coverage.
 *
 * The test creates a payment that mimics the orphan condition (APPROVED,
 * userId NULL, tokenExpiresAt in the past) plus a control payment that
 * should NOT be flipped, then asserts the cron acts on the right one.
 */
describe('PaymentsCron.cleanupOrphanedPayments (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cron: PaymentsCron;
  let auth: AuthService;
  const createdPaymentIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    cron = app.get(PaymentsCron);
    auth = app.get(AuthService);
  }, 30_000);

  afterAll(async () => {
    if (prisma && createdPaymentIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: createdPaymentIds }, entity: 'payment' },
      });
      await prisma.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (app) await app.close();
  }, 30_000);

  it('flips eligible payments to ORPHANED and audits each one', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);

    // Eligible: APPROVED, no user, token expired
    const expired = await prisma.payment.create({
      data: {
        userId: null,
        amount: 15_000,
        method: 'MERCADOPAGO',
        status: 'APPROVED',
        completionTokenHash: auth.hashToken('orphan-' + Date.now() + '-1'),
        tokenExpiresAt: yesterday,
        paidAt: yesterday,
      },
    });
    createdPaymentIds.push(expired.id);

    // NOT eligible: token still valid
    const stillValid = await prisma.payment.create({
      data: {
        userId: null,
        amount: 15_000,
        method: 'MERCADOPAGO',
        status: 'APPROVED',
        completionTokenHash: auth.hashToken('orphan-' + Date.now() + '-2'),
        tokenExpiresAt: tomorrow,
        paidAt: new Date(),
      },
    });
    createdPaymentIds.push(stillValid.id);

    // NOT eligible: still PENDING
    const pending = await prisma.payment.create({
      data: {
        userId: null,
        amount: 15_000,
        method: 'MERCADOPAGO',
        status: 'PENDING',
        completionTokenHash: auth.hashToken('orphan-' + Date.now() + '-3'),
        tokenExpiresAt: yesterday,
      },
    });
    createdPaymentIds.push(pending.id);

    const flipped = await cron.cleanupOrphanedPayments();
    expect(flipped).toBeGreaterThanOrEqual(1);

    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: expired.id },
    });
    expect(after.status).toBe('ORPHANED');

    const stillApproved = await prisma.payment.findUniqueOrThrow({
      where: { id: stillValid.id },
    });
    expect(stillApproved.status).toBe('APPROVED');

    const stillPending = await prisma.payment.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(stillPending.status).toBe('PENDING');

    // Wait briefly for the audit log writes (the AuditService writes
    // are synchronous in the cron path; this is just defensive).
    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'payment.marked_orphaned',
        entityId: expired.id,
      },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 when no payments are eligible', async () => {
    // Re-running immediately after the previous test should be a no-op
    // since both eligible payments have already been flipped.
    const flipped = await cron.cleanupOrphanedPayments();
    expect(flipped).toBe(0);
  });
});
