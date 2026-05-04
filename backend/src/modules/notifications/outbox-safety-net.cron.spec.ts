import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { OutboxSafetyNetCron } from './outbox-safety-net.cron.js';
import { SEND_NOTIFICATION_JOB } from './notifications.constants.js';

/**
 * Integration test for `OutboxSafetyNetCron.sweepStuckNotifications`.
 *
 * Strategy: directly insert a Notification row with `status='PENDING'`
 * and a `createdAt` deliberately older than the 5-minute staleness
 * threshold. Spy on `queue.add` to assert the cron re-enqueues it,
 * and ensure the same call is idempotent across re-runs (BullMQ
 * jobId-based dedup absorbs the re-add).
 *
 * We use a shared spy on the BullMQ queue rather than mocking it
 * outright because the rest of the AppModule wires real BullMQ
 * listeners and we want them to keep working — the spy lets the
 * underlying call through.
 */
describe('OutboxSafetyNetCron.sweepStuckNotifications (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cron: OutboxSafetyNetCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queue: any;
  let queueAddSpy: jest.SpiedFunction<(...a: unknown[]) => Promise<unknown>>;
  const createdNotificationIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    cron = app.get(OutboxSafetyNetCron);
    // The notifications queue is registered both globally (via the
    // shared BullMqModule) and locally inside several feature modules
    // (notifications, scoring, payments). Multiple Queue instances
    // therefore exist for the same name, and `app.get(getQueueToken(...))`
    // can return a different instance than the one Nest injected into
    // this cron. Spy on the cron's own queue instance to ensure we
    // capture every `queue.add` it issues.
    queue = (cron as unknown as { queue: typeof queue }).queue;
    queueAddSpy = jest.spyOn(queue, 'add') as unknown as typeof queueAddSpy;
  }, 30_000);

  afterAll(async () => {
    queueAddSpy?.mockRestore();
    if (prisma && createdNotificationIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: createdNotificationIds } },
      });
    }
    if (app) await app.close();
  }, 30_000);

  beforeEach(() => {
    queueAddSpy.mockClear();
  });

  it('re-enqueues PENDING notifications older than 5 min', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const dedupKey = `safety-net-test:${Date.now()}`;
    const stuck = await prisma.notification.create({
      data: {
        toAddress: '5491111111111',
        type: 'MATCH_REMINDER',
        title: 'stuck',
        message: 'pending forever',
        channel: 'WHATSAPP',
        status: 'PENDING',
        dedupKey,
        // Force createdAt into the past so the cron picks it up.
        createdAt: tenMinutesAgo,
      },
    });
    createdNotificationIds.push(stuck.id);

    const rescued = await cron.sweepStuckNotifications();
    expect(rescued).toBeGreaterThanOrEqual(1);

    // The cron must have called queue.add with `send-notification` and
    // the row's id. We don't assert exact-only because other suite-leftover
    // PENDING rows in the shared DB can also be rescued.
    const addCalls = queueAddSpy.mock.calls;
    const hit = addCalls.find(
      (call) =>
        call[0] === SEND_NOTIFICATION_JOB &&
        (call[1] as { notificationId?: string })?.notificationId === stuck.id,
    );
    expect(hit).toBeTruthy();
    // jobId follows the same convention as the producer.
    expect(
      (hit?.[2] as { jobId?: string })?.jobId,
    ).toBe(`notif-${dedupKey.replace(/:/g, '_')}`);
  });

  it('does NOT re-enqueue rows younger than the 5-min threshold', async () => {
    const veryRecent = await prisma.notification.create({
      data: {
        toAddress: '5491111111111',
        type: 'MATCH_REMINDER',
        title: 'fresh',
        message: 'just now',
        channel: 'WHATSAPP',
        status: 'PENDING',
        // No dedupKey, default createdAt = now.
      },
    });
    createdNotificationIds.push(veryRecent.id);

    queueAddSpy.mockClear();
    await cron.sweepStuckNotifications();

    const hit = queueAddSpy.mock.calls.find(
      (call) =>
        (call[1] as { notificationId?: string })?.notificationId ===
        veryRecent.id,
    );
    expect(hit).toBeFalsy();
  });

  it('does NOT re-enqueue rows whose status is no longer PENDING', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const sent = await prisma.notification.create({
      data: {
        toAddress: '5491111111111',
        type: 'MATCH_REMINDER',
        title: 'sent',
        message: 'already delivered',
        channel: 'WHATSAPP',
        status: 'SENT',
        sentAt: tenMinutesAgo,
        createdAt: tenMinutesAgo,
      },
    });
    createdNotificationIds.push(sent.id);

    queueAddSpy.mockClear();
    await cron.sweepStuckNotifications();

    const hit = queueAddSpy.mock.calls.find(
      (call) =>
        (call[1] as { notificationId?: string })?.notificationId === sent.id,
    );
    expect(hit).toBeFalsy();
  });

  it('falls back to a deterministic recover jobId when dedupKey is null', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const noDedup = await prisma.notification.create({
      data: {
        toAddress: '5491111111111',
        type: 'MATCH_REMINDER',
        title: 'no-dedup',
        message: 'rescue me',
        channel: 'WHATSAPP',
        status: 'PENDING',
        createdAt: tenMinutesAgo,
      },
    });
    createdNotificationIds.push(noDedup.id);

    queueAddSpy.mockClear();
    await cron.sweepStuckNotifications();

    const hit = queueAddSpy.mock.calls.find(
      (call) =>
        (call[1] as { notificationId?: string })?.notificationId ===
        noDedup.id,
    );
    expect(hit).toBeTruthy();
    expect(
      (hit?.[2] as { jobId?: string })?.jobId,
    ).toBe(`notif-recover-${noDedup.id}`);
  });
});
