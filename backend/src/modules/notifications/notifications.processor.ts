import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { WhatsappService } from '../../shared/whatsapp/whatsapp.service.js';
import { EmailService } from '../../shared/email/email.service.js';
import {
  NOTIFICATIONS_QUEUE,
  SEND_NOTIFICATION_JOB,
} from './notifications.constants.js';

export interface SendNotificationJobData {
  notificationId: string;
}

/**
 * BullMQ worker for the `notifications` queue. Reads the Notification
 * row by id, dispatches it through the right channel, and updates the
 * row's status. The job options on the producer side already enforce
 * 3 attempts with exponential backoff — this processor only needs to
 * throw on failure for BullMQ to do the right thing.
 *
 * Behaviour:
 *   - Skips delivery (status=SKIPPED) when the row is missing toAddress
 *     for an outgoing channel — protects against bad upstream data.
 *   - Marks SENT on success, FAILED on the LAST attempt failure.
 *     Intermediate failures keep status as PENDING so we can see
 *     in-progress rows (`attempts` is incremented every try).
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly email: EmailService,
  ) {
    super();
  }

  async process(job: Job<SendNotificationJobData>): Promise<void> {
    if (job.name !== SEND_NOTIFICATION_JOB) {
      // Ignore unknown job names defensively; throwing here would burn retries
      // for jobs that may have been added by an older deploy.
      this.logger.warn(`Unknown job name on ${NOTIFICATIONS_QUEUE}: ${job.name}`);
      return;
    }

    const { notificationId } = job.data;
    const notif = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notif) {
      this.logger.warn(
        `Notification ${notificationId} not found — dropping job ${job.id}`,
      );
      return;
    }

    // Already-SENT rows happen when the same dedupKey gets re-queued or when
    // BullMQ retries a job that succeeded server-side but the ack was lost.
    if (notif.status === 'SENT' || notif.status === 'SKIPPED') {
      return;
    }

    // Bump attempts upfront so the row reflects the in-flight retry count
    // even if the channel call hangs.
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { attempts: { increment: 1 } },
    });

    if (notif.channel !== 'IN_APP' && !notif.toAddress) {
      await this.markSkipped(notificationId, 'missing toAddress');
      return;
    }

    try {
      switch (notif.channel) {
        case 'WHATSAPP':
          await this.whatsapp.send(notif.toAddress as string, notif.message);
          break;
        case 'EMAIL':
          await this.email.send({
            to: notif.toAddress as string,
            subject: notif.title,
            html: notif.message,
            text: notif.message,
          });
          break;
        case 'IN_APP':
          // No external delivery — the DB row IS the delivery.
          break;
      }
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'SENT', sentAt: new Date(), failureReason: null },
      });
    } catch (err) {
      const reason = (err as Error).message;
      const attemptsTotal = job.opts.attempts ?? 1;
      const isLastAttempt = job.attemptsMade + 1 >= attemptsTotal;
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: isLastAttempt ? 'FAILED' : 'PENDING',
          failureReason: reason.slice(0, 500),
        },
      });
      // Re-throw so BullMQ records the failure and triggers backoff/retry.
      throw err;
    }
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: { status: 'SKIPPED', failureReason: reason },
    });
  }
}
