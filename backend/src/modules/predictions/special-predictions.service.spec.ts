import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { SpecialPredictionsService } from './special-predictions.service.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { SpecialPredictionLockedException } from '../../common/exceptions/domain.exceptions.js';

/**
 * Unit tests for `SpecialPredictionsService`. The cross-field validation
 * (champion ≠ runnerUp ≠ third) and the global-lock check are pure logic
 * — easier to assert with a mocked Prisma than against the real DB.
 */
describe('SpecialPredictionsService.upsertSpecialPrediction (unit)', () => {
  type Existing = {
    id: string;
    lockedAt: Date | null;
    championTeamId: string | null;
    runnerUpTeamId: string | null;
    thirdPlaceTeamId: string | null;
    topScorerId: string | null;
    topScorerName: string | null;
    totalGoals: number | null;
  };

  function makeService(opts: {
    existing?: Existing | null;
    anyLocked?: { id: string } | null;
    upsertResult?: Partial<Existing>;
  }) {
    const auditCalls: Array<Record<string, unknown>> = [];
    const upserts: unknown[] = [];

    const prisma = {
      specialPrediction: {
        findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
        findFirst: jest.fn().mockResolvedValue(opts.anyLocked ?? null),
        upsert: jest.fn().mockImplementation((args: unknown) => {
          upserts.push(args);
          const merged = {
            id: 'sp-1',
            lockedAt: null,
            championTeamId: null,
            runnerUpTeamId: null,
            thirdPlaceTeamId: null,
            topScorerId: null,
            topScorerName: null,
            totalGoals: null,
            ...(opts.upsertResult ?? {}),
          };
          return Promise.resolve(merged);
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
      service: new SpecialPredictionsService(prisma, audit),
      audit,
      auditCalls,
      upserts,
    };
  }

  it('throws when champion === runnerUp', async () => {
    const { service } = makeService({});
    await expect(
      service.upsertSpecialPrediction('user-1', {
        championTeamId: 't1',
        runnerUpTeamId: 't1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when runnerUp === third', async () => {
    const { service } = makeService({});
    await expect(
      service.upsertSpecialPrediction('user-1', {
        runnerUpTeamId: 't2',
        thirdPlaceTeamId: 't2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts only some picks set (no duplicates)', async () => {
    const { service, upserts } = makeService({
      upsertResult: { championTeamId: 't1' },
    });
    await service.upsertSpecialPrediction('user-1', {
      championTeamId: 't1',
    });
    expect(upserts).toHaveLength(1);
  });

  it('throws when totalGoals === 0', async () => {
    const { service } = makeService({});
    await expect(
      service.upsertSpecialPrediction('user-1', { totalGoals: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws SpecialPredictionLockedException when row.lockedAt is set', async () => {
    const { service } = makeService({
      existing: {
        id: 'sp-1',
        lockedAt: new Date(),
        championTeamId: null,
        runnerUpTeamId: null,
        thirdPlaceTeamId: null,
        topScorerId: null,
        topScorerName: null,
        totalGoals: null,
      },
    });
    await expect(
      service.upsertSpecialPrediction('user-1', { totalGoals: 100 }),
    ).rejects.toBeInstanceOf(SpecialPredictionLockedException);
  });

  it('throws SpecialPredictionLockedException when no row but global lock fired', async () => {
    const { service } = makeService({
      existing: null,
      anyLocked: { id: 'sp-other' },
    });
    await expect(
      service.upsertSpecialPrediction('user-2', { totalGoals: 100 }),
    ).rejects.toBeInstanceOf(SpecialPredictionLockedException);
  });

  it('audits special_prediction.created on first write', async () => {
    const { service, auditCalls } = makeService({
      existing: null,
      upsertResult: { id: 'sp-new' },
    });
    await service.upsertSpecialPrediction('user-3', { totalGoals: 100 });
    await new Promise((r) => setImmediate(r));
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: 'special_prediction.created',
      entity: 'special_prediction',
      entityId: 'sp-new',
    });
  });

  it('audits special_prediction.updated when row already existed', async () => {
    const { service, auditCalls } = makeService({
      existing: {
        id: 'sp-x',
        lockedAt: null,
        championTeamId: 'old',
        runnerUpTeamId: null,
        thirdPlaceTeamId: null,
        topScorerId: null,
        topScorerName: null,
        totalGoals: 50,
      },
      upsertResult: { id: 'sp-x', championTeamId: 'old', totalGoals: 75 },
    });
    await service.upsertSpecialPrediction('user-3', { totalGoals: 75 });
    await new Promise((r) => setImmediate(r));
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]!.action).toBe('special_prediction.updated');
    const changes = auditCalls[0]!.changes as Record<string, unknown>;
    expect(changes).toHaveProperty('before');
    expect(changes).toHaveProperty('after');
  });
});
