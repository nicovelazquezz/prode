import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PredictionsService } from './predictions.service.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { PredictionLockedException } from '../../common/exceptions/domain.exceptions.js';

/**
 * Pure unit tests for `PredictionsService.upsertMatchPrediction`. We mock
 * Prisma + AuditService — the integration path against the real DB lives
 * in `predictions.controller.spec.ts`.
 *
 * Multi-prode (post v1.1): the service is keyed by entryId, with the
 * owning userId passed via the audit context for trail anchoring.
 *
 * Coverage focus:
 *   - 404 when match doesn't exist
 *   - PredictionLockedException when now() ≥ predictionsLockAt
 *   - score range validation (negative, > 99, non-integer)
 *   - audit action `prediction.created` on first write
 *   - audit action `prediction.updated` when row already existed
 */
describe('PredictionsService.upsertMatchPrediction (unit)', () => {
  function makeService(opts: {
    match?: { id: string; predictionsLockAt: Date } | null;
    existing?: { id: string; scoreHome: number; scoreAway: number } | null;
    upsertResult?: { id: string; scoreHome: number; scoreAway: number };
  }) {
    const auditCalls: Array<Record<string, unknown>> = [];
    const upsertCalls: Array<unknown> = [];

    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue(opts.match ?? null),
      },
      prediction: {
        findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
        upsert: jest.fn().mockImplementation((args: unknown) => {
          upsertCalls.push(args);
          return Promise.resolve(
            opts.upsertResult ?? { id: 'pred-1', scoreHome: 0, scoreAway: 0 },
          );
        }),
      },
    } as unknown as PrismaService;

    const audit = {
      log: jest.fn().mockImplementation((row: Record<string, unknown>) => {
        auditCalls.push(row);
        return Promise.resolve();
      }),
    } as unknown as AuditService;

    return {
      service: new PredictionsService(prisma, audit),
      audit,
      auditCalls,
      upsertCalls,
      prisma,
    };
  }

  const futureLock = new Date(Date.now() + 60 * 60 * 1000);
  const pastLock = new Date(Date.now() - 1000);

  it('throws NotFound when the match does not exist', async () => {
    const { service } = makeService({ match: null });
    await expect(
      service.upsertMatchPrediction('entry-1', 'missing', {
        scoreHome: 1,
        scoreAway: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws PredictionLockedException when now ≥ predictionsLockAt', async () => {
    const { service } = makeService({
      match: { id: 'm1', predictionsLockAt: pastLock },
    });
    await expect(
      service.upsertMatchPrediction('entry-1', 'm1', {
        scoreHome: 1,
        scoreAway: 0,
      }),
    ).rejects.toBeInstanceOf(PredictionLockedException);
  });

  it('rejects negative scores with 400', async () => {
    const { service } = makeService({
      match: { id: 'm1', predictionsLockAt: futureLock },
    });
    await expect(
      service.upsertMatchPrediction('e', 'm1', {
        scoreHome: -1,
        scoreAway: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects scores > 99 with 400', async () => {
    const { service } = makeService({
      match: { id: 'm1', predictionsLockAt: futureLock },
    });
    await expect(
      service.upsertMatchPrediction('e', 'm1', {
        scoreHome: 100,
        scoreAway: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer scores with 400', async () => {
    const { service } = makeService({
      match: { id: 'm1', predictionsLockAt: futureLock },
    });
    await expect(
      service.upsertMatchPrediction('e', 'm1', {
        scoreHome: 1.5,
        scoreAway: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes an audit row with action prediction.created on first write', async () => {
    const { service, auditCalls } = makeService({
      match: { id: 'm1', predictionsLockAt: futureLock },
      existing: null,
      upsertResult: { id: 'pred-new', scoreHome: 2, scoreAway: 1 },
    });
    const result = await service.upsertMatchPrediction(
      'entry-7',
      'm1',
      { scoreHome: 2, scoreAway: 1 },
      { ipAddress: '127.0.0.1', userAgent: 'jest', userId: 'user-7' },
    );
    expect(result.id).toBe('pred-new');
    // Allow the fire-and-forget audit promise to settle.
    await new Promise((r) => setImmediate(r));
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      userId: 'user-7',
      action: 'prediction.created',
      entity: 'prediction',
      entityId: 'pred-new',
    });
    const changes = auditCalls[0]!.changes as Record<string, unknown>;
    expect(changes.entryId).toBe('entry-7');
  });

  it('writes an audit row with action prediction.updated when row exists', async () => {
    const { service, auditCalls } = makeService({
      match: { id: 'm1', predictionsLockAt: futureLock },
      existing: { id: 'pred-1', scoreHome: 1, scoreAway: 1 },
      upsertResult: { id: 'pred-1', scoreHome: 3, scoreAway: 2 },
    });
    await service.upsertMatchPrediction(
      'entry-7',
      'm1',
      { scoreHome: 3, scoreAway: 2 },
      { userId: 'user-7' },
    );
    await new Promise((r) => setImmediate(r));
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: 'prediction.updated',
      entity: 'prediction',
      entityId: 'pred-1',
    });
    const changes = auditCalls[0]!.changes as Record<string, unknown>;
    expect(changes.before).toEqual({ scoreHome: 1, scoreAway: 1 });
    expect(changes.after).toEqual({ scoreHome: 3, scoreAway: 2 });
    expect(changes.entryId).toBe('entry-7');
  });

  it('passes scores verbatim into prisma.prediction.upsert (keyed by entryId)', async () => {
    const { service, upsertCalls } = makeService({
      match: { id: 'm1', predictionsLockAt: futureLock },
    });
    await service.upsertMatchPrediction('entry-1', 'm1', {
      scoreHome: 0,
      scoreAway: 0,
    });
    expect(upsertCalls).toHaveLength(1);
    const args = upsertCalls[0] as {
      where: { entryId_matchId: { entryId: string; matchId: string } };
      create: { entryId: string; matchId: string; scoreHome: number; scoreAway: number };
      update: { scoreHome: number; scoreAway: number };
    };
    expect(args.where.entryId_matchId).toEqual({
      entryId: 'entry-1',
      matchId: 'm1',
    });
    expect(args.create.entryId).toBe('entry-1');
    expect(args.create.scoreHome).toBe(0);
    expect(args.update.scoreAway).toBe(0);
  });
});
