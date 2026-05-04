import { jest } from '@jest/globals';
import { NotificationsProcessor } from './notifications.processor.js';
import { SEND_NOTIFICATION_JOB } from './notifications.constants.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { WhatsappService } from '../../shared/whatsapp/whatsapp.service.js';
import type { EmailService } from '../../shared/email/email.service.js';
import type { Job } from 'bullmq';

type Notif = {
  id: string;
  toAddress: string | null;
  type: string;
  title: string;
  message: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
};

function makePrismaMock(initial: Notif | null) {
  const findUnique = jest.fn<(args: { where: { id: string } }) => Promise<Notif | null>>();
  findUnique.mockResolvedValue(initial);

  const updateCalls: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const update = jest.fn<
    (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<Notif>
  >();
  update.mockImplementation(async (args) => {
    updateCalls.push(args);
    return (initial ?? ({} as Notif));
  });

  const prisma = {
    notification: { findUnique, update },
  } as unknown as PrismaService;

  return { prisma, findUnique, update, updateCalls };
}

function makeJob(
  data: { notificationId: string },
  opts?: { attempts?: number; attemptsMade?: number; name?: string },
): Job<{ notificationId: string }> {
  return {
    id: 'job_test',
    name: opts?.name ?? SEND_NOTIFICATION_JOB,
    data,
    attemptsMade: opts?.attemptsMade ?? 0,
    opts: { attempts: opts?.attempts ?? 3 },
  } as unknown as Job<{ notificationId: string }>;
}

function makeWhatsappMock() {
  const send = jest.fn<WhatsappService['send']>();
  send.mockResolvedValue(undefined);
  return { whatsapp: { send } as unknown as WhatsappService, send };
}

function makeEmailMock() {
  const send = jest.fn<EmailService['send']>();
  send.mockResolvedValue(undefined);
  return { email: { send } as unknown as EmailService, send };
}

describe('NotificationsProcessor', () => {
  it('marks Notification as SENT after a successful WhatsApp delivery', async () => {
    const notif: Notif = {
      id: 'n_1',
      toAddress: '5491111111111',
      type: 'PASSWORD_RESET',
      title: 't',
      message: 'hello',
      channel: 'WHATSAPP',
      status: 'PENDING',
    };
    const { prisma, updateCalls } = makePrismaMock(notif);
    const { whatsapp, send: waSend } = makeWhatsappMock();
    const { email } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    await proc.process(makeJob({ notificationId: 'n_1' }));

    expect(waSend).toHaveBeenCalledWith('5491111111111', 'hello');
    // Two updates: attempts++ then status=SENT.
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].data).toEqual({ attempts: { increment: 1 } });
    expect(updateCalls[1].data).toMatchObject({
      status: 'SENT',
      failureReason: null,
    });
    expect(updateCalls[1].data.sentAt).toBeInstanceOf(Date);
  });

  it('marks Notification as SENT after a successful EMAIL delivery and forwards subject/html/text', async () => {
    const notif: Notif = {
      id: 'n_2',
      toAddress: 'a@b.com',
      type: 'ADMIN_BROADCAST',
      title: 'Subj',
      message: '<p>body</p>',
      channel: 'EMAIL',
      status: 'PENDING',
    };
    const { prisma, updateCalls } = makePrismaMock(notif);
    const { whatsapp } = makeWhatsappMock();
    const { email, send: emSend } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    await proc.process(makeJob({ notificationId: 'n_2' }));

    expect(emSend).toHaveBeenCalledWith({
      to: 'a@b.com',
      subject: 'Subj',
      html: '<p>body</p>',
      text: '<p>body</p>',
    });
    expect(updateCalls.at(-1)?.data).toMatchObject({ status: 'SENT' });
  });

  it('keeps status=PENDING on intermediate retry failures and re-throws so BullMQ retries', async () => {
    const notif: Notif = {
      id: 'n_3',
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 't',
      message: 'm',
      channel: 'WHATSAPP',
      status: 'PENDING',
    };
    const { prisma, updateCalls } = makePrismaMock(notif);
    const { whatsapp, send: waSend } = makeWhatsappMock();
    waSend.mockRejectedValueOnce(new Error('503 boom'));
    const { email } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    // attempt 1 of 3 — should NOT mark FAILED.
    await expect(
      proc.process(
        makeJob({ notificationId: 'n_3' }, { attempts: 3, attemptsMade: 0 }),
      ),
    ).rejects.toThrow(/503/);

    const lastUpdate = updateCalls.at(-1)!.data;
    expect(lastUpdate.status).toBe('PENDING');
    expect(lastUpdate.failureReason).toContain('503');
  });

  it('marks status=FAILED after the LAST attempt fails (3 of 3)', async () => {
    const notif: Notif = {
      id: 'n_4',
      toAddress: '5491111111111',
      type: 'MATCH_REMINDER',
      title: 't',
      message: 'm',
      channel: 'WHATSAPP',
      status: 'PENDING',
    };
    const { prisma, updateCalls } = makePrismaMock(notif);
    const { whatsapp, send: waSend } = makeWhatsappMock();
    waSend.mockRejectedValueOnce(new Error('still down'));
    const { email } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    await expect(
      proc.process(
        makeJob({ notificationId: 'n_4' }, { attempts: 3, attemptsMade: 2 }),
      ),
    ).rejects.toThrow(/still down/);

    const lastUpdate = updateCalls.at(-1)!.data;
    expect(lastUpdate.status).toBe('FAILED');
    expect(lastUpdate.failureReason).toContain('still down');
  });

  it('skips delivery (status=SKIPPED) when toAddress is missing for an outgoing channel', async () => {
    const notif: Notif = {
      id: 'n_5',
      toAddress: null,
      type: 'MATCH_REMINDER',
      title: 't',
      message: 'm',
      channel: 'WHATSAPP',
      status: 'PENDING',
    };
    const { prisma, updateCalls } = makePrismaMock(notif);
    const { whatsapp, send: waSend } = makeWhatsappMock();
    const { email } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    await proc.process(makeJob({ notificationId: 'n_5' }));

    expect(waSend).not.toHaveBeenCalled();
    expect(updateCalls.at(-1)?.data).toMatchObject({
      status: 'SKIPPED',
      failureReason: 'missing toAddress',
    });
  });

  it('is a no-op when the Notification row is missing (already deleted)', async () => {
    const { prisma, updateCalls } = makePrismaMock(null);
    const { whatsapp, send: waSend } = makeWhatsappMock();
    const { email } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    await proc.process(makeJob({ notificationId: 'gone' }));

    expect(waSend).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('is a no-op when the row is already SENT (idempotent re-delivery)', async () => {
    const notif: Notif = {
      id: 'n_6',
      toAddress: '5491111111111',
      type: 'PASSWORD_RESET',
      title: 't',
      message: 'm',
      channel: 'WHATSAPP',
      status: 'SENT',
    };
    const { prisma, updateCalls } = makePrismaMock(notif);
    const { whatsapp, send: waSend } = makeWhatsappMock();
    const { email } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    await proc.process(makeJob({ notificationId: 'n_6' }));

    expect(waSend).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('ignores jobs whose name is not send-notification (forward-compat)', async () => {
    const { prisma, findUnique } = makePrismaMock(null);
    const { whatsapp } = makeWhatsappMock();
    const { email } = makeEmailMock();
    const proc = new NotificationsProcessor(prisma, whatsapp, email);

    await proc.process(makeJob({ notificationId: 'x' }, { name: 'unknown-job' }));

    expect(findUnique).not.toHaveBeenCalled();
  });
});
