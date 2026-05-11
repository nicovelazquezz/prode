import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { WhatsappService } from '../../shared/whatsapp/whatsapp.service.js';

/**
 * Integration test for the full notifications pipeline:
 *   NotificationsService.enqueue → BullMQ Redis → NotificationsProcessor
 *
 * Uses the real Postgres (Notification row lifecycle) and the real Redis
 * (BullMQ queue + worker), but the WhatsappService is mocked so the worker
 * never reaches out to example.com. Polls the DB for status transitions
 * because the worker runs asynchronously inside the Nest container.
 */
describe('Notifications pipeline (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let waSendMock: jest.Mock<(to: string, message: string) => Promise<void>>;

  const TEST_DEDUP_PREFIX = 'integration-test:';

  beforeAll(async () => {
    waSendMock = jest.fn<(to: string, message: string) => Promise<void>>();
    // The shim is a thin closure around the typed jest.fn() — we hand
    // Nest a plain function so the DI container's type checks don't
    // care that jest.Mock is a callable + decorated object. Calls and
    // implementation flow through `waSendMock` exactly the same.
    const sendShim = (to: string, message: string): Promise<void> =>
      waSendMock(to, message);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WhatsappService)
      .useValue({ send: sendShim })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);

    // Give the BullMQ worker a moment to attach its blocking listener to
    // Redis. Without this, the very first job can sit in `wait` until the
    // worker's reconnect loop kicks in and we burn the test budget.
    await new Promise((r) => setTimeout(r, 1500));
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.notification.deleteMany({
        where: { dedupKey: { startsWith: TEST_DEDUP_PREFIX } },
      });
    }
    if (app) await app.close();
  }, 30_000);

  beforeEach(() => {
    waSendMock.mockReset();
  });

  /** Polls the Notification row until `predicate` is true or timeout. */
  async function waitForNotif(
    id: string,
    predicate: (n: Awaited<ReturnType<typeof prisma.notification.findUnique>>) => boolean,
    timeoutMs = 10_000,
  ) {
    const start = Date.now();
    let last: Awaited<ReturnType<typeof prisma.notification.findUnique>> = null;
    while (Date.now() - start < timeoutMs) {
      last = await prisma.notification.findUnique({ where: { id } });
      if (predicate(last)) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    return last;
  }

  it('processes a WhatsApp Notification end-to-end and marks it SENT', async () => {
    waSendMock.mockImplementation(async () => undefined);

    const dedupKey = `${TEST_DEDUP_PREFIX}sent:${Date.now()}`;
    const notif = await notifications.enqueue({
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 'Recordatorio',
      message: 'Tu partido empieza pronto',
      channel: 'WHATSAPP',
      dedupKey,
    });

    const final = await waitForNotif(notif.id, (n) => n?.status === 'SENT', 20_000);
    expect(final?.status).toBe('SENT');
    expect(final?.sentAt).toBeInstanceOf(Date);
    expect(final?.attempts).toBeGreaterThanOrEqual(1);
    expect(waSendMock).toHaveBeenCalledWith(
      '5491111111111',
      'Tu partido empieza pronto',
    );
  }, 30_000);

  it('marks the row FAILED after the WhatsappService throws on every retry', async () => {
    waSendMock.mockImplementation(async () => {
      throw new Error('upstream 503');
    });

    const dedupKey = `${TEST_DEDUP_PREFIX}failed:${Date.now()}`;
    const notif = await notifications.enqueue({
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 'Recordatorio',
      message: 'Tu partido empieza pronto',
      channel: 'WHATSAPP',
      dedupKey,
    });

    // 3 attempts × 5s exponential backoff means ~15s upper bound to
    // reach FAILED — give 30s headroom for cold-start jitter. We poll
    // the row instead of leaning on a fixed sleep so a fast machine
    // exits early.
    const truly = await waitForNotif(
      notif.id,
      (n) => n?.status === 'FAILED',
      30_000,
    );
    expect(waSendMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(truly?.status).toBe('FAILED');
    expect(truly?.failureReason).toContain('503');
  }, 60_000);

  it('dedupKey prevents duplicate Notification rows on repeated enqueue calls', async () => {
    waSendMock.mockImplementation(async () => undefined);

    const dedupKey = `${TEST_DEDUP_PREFIX}dedup:${Date.now()}`;
    const a = await notifications.enqueue({
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 't',
      message: 'first',
      channel: 'WHATSAPP',
      dedupKey,
    });
    const b = await notifications.enqueue({
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 't',
      message: 'second-should-be-ignored',
      channel: 'WHATSAPP',
      dedupKey,
    });

    expect(b.id).toBe(a.id);

    const rows = await prisma.notification.findMany({ where: { dedupKey } });
    expect(rows).toHaveLength(1);
    // First enqueue's message wins because update is a no-op on dup.
    expect(rows[0].message).toBe('first');
  }, 30_000);
});
