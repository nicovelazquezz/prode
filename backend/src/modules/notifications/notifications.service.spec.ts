import { jest } from '@jest/globals';
import { NotificationsService } from './notifications.service.js';
import {
  SEND_NOTIFICATION_JOB,
  SEND_NOTIFICATION_JOB_OPTS,
} from './notifications.constants.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { Queue } from 'bullmq';

type CreateArgs = Parameters<PrismaService['notification']['create']>[0];
type UpsertArgs = Parameters<PrismaService['notification']['upsert']>[0];

function makePrismaMock() {
  const create = jest.fn<(args: CreateArgs) => Promise<unknown>>();
  const upsert = jest.fn<(args: UpsertArgs) => Promise<unknown>>();
  const prisma = {
    notification: { create, upsert },
  } as unknown as PrismaService;
  return { prisma, create, upsert };
}

function makeQueueMock() {
  const add =
    jest.fn<
      (
        name: string,
        data: unknown,
        opts?: Record<string, unknown>,
      ) => Promise<{ id: string }>
    >();
  add.mockResolvedValue({ id: 'job_1' });
  const queue = { add } as unknown as Queue;
  return { queue, add };
}

describe('NotificationsService.enqueue', () => {
  it('creates a PENDING Notification (no dedupKey) and queues a send-notification job', async () => {
    const { prisma, create, upsert } = makePrismaMock();
    create.mockResolvedValue({ id: 'notif_1' });
    const { queue, add } = makeQueueMock();
    const svc = new NotificationsService(prisma, queue);

    const result = await svc.enqueue({
      userId: 'u_1',
      toAddress: '5491111111111',
      type: 'PASSWORD_RESET',
      title: 'Recuperá tu contraseña',
      message: 'hola',
      channel: 'WHATSAPP',
    });

    expect((result as { id: string }).id).toBe('notif_1');

    expect(create).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
    const createPayload = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(createPayload.userId).toBe('u_1');
    expect(createPayload.toAddress).toBe('5491111111111');
    expect(createPayload.type).toBe('PASSWORD_RESET');
    expect(createPayload.channel).toBe('WHATSAPP');
    expect(createPayload.status).toBe('PENDING');
    expect(createPayload.dedupKey).toBeUndefined();

    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, jobData, jobOpts] = add.mock.calls[0];
    expect(jobName).toBe(SEND_NOTIFICATION_JOB);
    expect(jobData).toEqual({ notificationId: 'notif_1' });
    expect(jobOpts).toMatchObject({
      attempts: SEND_NOTIFICATION_JOB_OPTS.attempts,
      backoff: SEND_NOTIFICATION_JOB_OPTS.backoff,
    });
    // No dedupKey means no jobId override.
    expect((jobOpts as Record<string, unknown> | undefined)?.jobId).toBeUndefined();
  });

  it('uses upsert when dedupKey is provided and forwards it as jobId', async () => {
    const { prisma, create, upsert } = makePrismaMock();
    upsert.mockResolvedValue({ id: 'notif_dedup' });
    const { queue, add } = makeQueueMock();
    const svc = new NotificationsService(prisma, queue);

    await svc.enqueue({
      userId: null,
      toAddress: 'admin@x.com',
      type: 'ADMIN_BROADCAST',
      title: 'Pago huérfano',
      message: 'detalle',
      channel: 'EMAIL',
      dedupKey: 'orphan:pay_42',
    });

    expect(create).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = upsert.mock.calls[0][0];
    expect((upsertArgs.where as { dedupKey: string }).dedupKey).toBe('orphan:pay_42');
    // update is intentionally a no-op so SENT rows aren't reset.
    expect(upsertArgs.update).toEqual({});
    expect((upsertArgs.create as Record<string, unknown>).dedupKey).toBe('orphan:pay_42');

    const jobOpts = add.mock.calls[0][2] as Record<string, unknown>;
    // Colons in the dedupKey get sanitized because BullMQ reserves ':'
    // for internal Redis key namespacing.
    expect(jobOpts.jobId).toBe('notif-orphan_pay_42');
  });

  it('coerces metadata=undefined when not provided so Prisma stores JSON null', async () => {
    const { prisma, create } = makePrismaMock();
    create.mockResolvedValue({ id: 'notif_meta' });
    const { queue } = makeQueueMock();
    const svc = new NotificationsService(prisma, queue);

    await svc.enqueue({
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 't',
      message: 'm',
      channel: 'WHATSAPP',
    });

    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.metadata).toBeUndefined();
  });

  it('does not throw if BullMQ queue.add fails — DB row stays PENDING', async () => {
    const { prisma, create } = makePrismaMock();
    create.mockResolvedValue({ id: 'notif_resilient' });
    const { queue, add } = makeQueueMock();
    add.mockRejectedValueOnce(new Error('redis down'));
    const svc = new NotificationsService(prisma, queue);

    await expect(
      svc.enqueue({
        toAddress: '5491111111111',
        type: 'MATCH_RESULT',
        title: 't',
        message: 'm',
        channel: 'WHATSAPP',
      }),
    ).resolves.toBeDefined();
  });

  it('enqueueAfterCommit is functionally equivalent to enqueue', async () => {
    const { prisma, create } = makePrismaMock();
    create.mockResolvedValue({ id: 'notif_oc' });
    const { queue, add } = makeQueueMock();
    const svc = new NotificationsService(prisma, queue);

    await svc.enqueueAfterCommit({
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 't',
      message: 'm',
      channel: 'WHATSAPP',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });
});
