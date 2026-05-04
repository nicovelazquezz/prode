import { jest } from '@jest/globals';
import { AuditService } from './audit.service.js';

type AuditCreateArgs = {
  data: {
    userId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    changes?: unknown;
    ipAddress?: string;
    userAgent?: string;
  };
};

function makePrismaMock() {
  const create = jest.fn() as jest.Mock<(args: AuditCreateArgs) => Promise<unknown>>;
  create.mockResolvedValue({});
  return {
    create,
    prisma: { auditLog: { create } } as unknown as Parameters<
      typeof AuditService.prototype.log
    >[0] extends never
      ? never
      : ConstructorParameters<typeof AuditService>[0],
  };
}

describe('AuditService', () => {
  it('persists every field passed in', async () => {
    const { create, prisma } = makePrismaMock();
    const svc = new AuditService(prisma);

    await svc.log({
      userId: 'usr_1',
      action: 'prediction.created',
      entity: 'prediction',
      entityId: 'pred_42',
      changes: { scoreHome: 1, scoreAway: 0 },
      ipAddress: '10.0.0.1',
      userAgent: 'jest/29',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'usr_1',
        action: 'prediction.created',
        entity: 'prediction',
        entityId: 'pred_42',
        changes: { scoreHome: 1, scoreAway: 0 },
        ipAddress: '10.0.0.1',
        userAgent: 'jest/29',
      },
    });
  });

  it('coerces missing userId/entityId to null', async () => {
    const { create, prisma } = makePrismaMock();
    const svc = new AuditService(prisma);

    await svc.log({
      action: 'auth.login_failed',
      entity: 'auth',
    });

    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.data.userId).toBeNull();
    expect(call.data.entityId).toBeNull();
    expect(call.data.action).toBe('auth.login_failed');
  });

  it('passes `changes` as undefined when not provided so Prisma stores JSON null', async () => {
    const { create, prisma } = makePrismaMock();
    const svc = new AuditService(prisma);

    await svc.log({ action: 'phase.closed', entity: 'phase' });

    const call = create.mock.calls[0][0];
    // Prisma treats `undefined` as "do not write", which yields JSON null
    // in the column for an optional Json field. Asserting undefined here
    // pins the contract.
    expect(call.data.changes).toBeUndefined();
  });

  it('swallows DB errors so audit logging cannot break a request', async () => {
    const { create, prisma } = makePrismaMock();
    create.mockRejectedValueOnce(new Error('boom'));
    const svc = new AuditService(prisma);

    // Should NOT reject.
    await expect(
      svc.log({ action: 'x', entity: 'y' }),
    ).resolves.toBeUndefined();
  });
});
