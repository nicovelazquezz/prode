import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { PredictionsService } from './predictions.service.js';
import { PredictionLockedException } from '../../common/exceptions/domain.exceptions.js';

/**
 * Real-DB integration tests for `PredictionsService.upsertMatchPrediction`.
 * Bootstraps the full Nest app so `PrismaService`, `AuditService`, and the
 * `PredictionsService` itself are wired exactly as in production.
 *
 * Cleanup strategy: track every prediction + audit row we create and delete
 * them on `afterAll`, so re-runs against a sticky DB stay deterministic.
 */
describe('PredictionsService.upsertMatchPrediction (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: PredictionsService;

  // Multi-prode: predictions live on entries; the user is the entry's
  // human owner used for audit anchoring.
  let userId: string;
  let entryId: string;
  // We need two matches: one with a future lock (happy path) and one with
  // its lock pushed into the past (lock-window check).
  let openMatchId: string;
  let lockedMatchId: string;
  let originalLockedLockAt: Date;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    service = app.get(PredictionsService);

    // Make a throwaway USER + Payment + Entry. DNI/whatsapp anchored on
    // Date.now() so re-runs against a sticky DB stay deterministic.
    const stamp = Date.now() % 90_000_000;
    const user = await prisma.user.create({
      data: {
        dni: String(10_000_000 + stamp).slice(-8),
        firstName: 'Pred',
        lastName: 'Tester',
        whatsapp: `549${String(1_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: 'unused-hash-for-integration-test',
      },
    });
    userId = user.id;
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        amount: 10_000,
        method: 'CASH',
        status: 'APPROVED',
        paidAt: new Date(),
        completedAt: new Date(),
      },
    });
    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        paymentId: payment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });
    entryId = entry.id;

    // Pick two matches deterministically. matchNumber=70 / 71 are both in
    // the GROUPS phase per the seed and far enough from the matches that
    // the controller-level integration suite (Phase 6) exercises.
    const open = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 70 },
    });
    const locked = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 71 },
    });
    openMatchId = open.id;
    lockedMatchId = locked.id;
    originalLockedLockAt = locked.predictionsLockAt;

    // Force `lockedMatchId` into the past so we can test the lock branch.
    await prisma.match.update({
      where: { id: lockedMatchId },
      data: { predictionsLockAt: new Date(Date.now() - 60_000) },
    });
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Predictions cascade from Entry; deleting the user handles the
      // entry → prediction tree via the FK cascade.
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      // Restore the lock we pushed into the past.
      if (lockedMatchId && originalLockedLockAt) {
        await prisma.match.update({
          where: { id: lockedMatchId },
          data: { predictionsLockAt: originalLockedLockAt },
        });
      }
    }
    if (app) await app.close();
  }, 30_000);

  it('creates a prediction when called for the first time pre-lock', async () => {
    const result = await service.upsertMatchPrediction(
      entryId,
      openMatchId,
      { scoreHome: 2, scoreAway: 1 },
      { userId },
    );
    expect(result.entryId).toBe(entryId);
    expect(result.matchId).toBe(openMatchId);
    expect(result.scoreHome).toBe(2);
    expect(result.scoreAway).toBe(1);

    // Audit row written (fire-and-forget, give it a tick).
    await new Promise((r) => setTimeout(r, 100));
    const audit = await prisma.auditLog.findFirst({
      where: {
        userId,
        action: 'prediction.created',
        entity: 'prediction',
        entityId: result.id,
      },
    });
    expect(audit).toBeTruthy();
  });

  it('updates an existing prediction (idempotent upsert)', async () => {
    // Second call for the same (entryId, openMatchId) — should overwrite.
    const updated = await service.upsertMatchPrediction(
      entryId,
      openMatchId,
      { scoreHome: 4, scoreAway: 0 },
      { userId },
    );
    expect(updated.scoreHome).toBe(4);
    expect(updated.scoreAway).toBe(0);

    await new Promise((r) => setTimeout(r, 100));
    const audit = await prisma.auditLog.findFirst({
      where: {
        userId,
        action: 'prediction.updated',
        entity: 'prediction',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    const changes = audit!.changes as { before: unknown; after: unknown };
    expect(changes.before).toEqual({ scoreHome: 2, scoreAway: 1 });
    expect(changes.after).toEqual({ scoreHome: 4, scoreAway: 0 });
  });

  it('throws PredictionLockedException when the match is past lock', async () => {
    await expect(
      service.upsertMatchPrediction(entryId, lockedMatchId, {
        scoreHome: 1,
        scoreAway: 1,
      }),
    ).rejects.toBeInstanceOf(PredictionLockedException);
  });
});
