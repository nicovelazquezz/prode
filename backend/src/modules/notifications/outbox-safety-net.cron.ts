import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  NOTIFICATIONS_QUEUE,
  SEND_NOTIFICATION_JOB,
  SEND_NOTIFICATION_JOB_OPTS,
} from './notifications.constants.js';

/**
 * Safety net for the outbox pattern. Spec section 7.2 calls this out
 * explicitly: between writing the `Notification` row in a Postgres TX
 * and adding the BullMQ job in Redis, two things can leave us hanging:
 *
 *   1. The DB commit succeeds, then the process crashes before the job
 *      is added (or BullMQ rejects momentarily because Redis blipped).
 *   2. `addJob` swallows its own error today (so callers don't
 *      transactional-contagion-fail), and the row stays PENDING.
 *
 * Both paths leave a Notification row that the worker will never see.
 * This cron runs every 5 min and re-enqueues PENDING rows older than
 * 5 min, giving the worker a chance to deliver them. The 5-minute
 * grace period prevents racing with the producer's own dispatch path
 * (which adds the job within milliseconds of the row being persisted).
 *
 * Idempotency: BullMQ uses the dedupKey-derived `jobId` for the
 * outbox job, so re-adding a job for a row whose previous job is still
 * pending in Redis is a no-op. For rows without dedupKey we add a
 * deterministic jobId based on the notificationId, achieving the same
 * collapsing.
 */
@Injectable()
export class OutboxSafetyNetCron {
  private readonly logger = new Logger(OutboxSafetyNetCron.name);

  /** 5-minute floor: don't fight the producer's own job-add path. */
  private static readonly STALE_AFTER_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Returns the count of notifications re-enqueued. Public so the
   * integration test can drive it directly.
   */
  @Cron('*/5 * * * *')
  async sweepStuckNotifications(): Promise<number> {
    const cutoff = new Date(Date.now() - OutboxSafetyNetCron.STALE_AFTER_MS);

    // We pull a bounded batch — if 10k rows are stuck, processing them all
    // in a single tick would burn the queue connection and starve other
    // jobs. 500 keeps each sweep cheap; the next 5-minute tick will
    // drain the rest.
    const stuck = await this.prisma.notification.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
      },
      select: { id: true, dedupKey: true },
      take: 500,
      orderBy: { createdAt: 'asc' },
    });

    if (stuck.length === 0) return 0;

    let rescued = 0;
    for (const row of stuck) {
      try {
        await this.queue.add(
          SEND_NOTIFICATION_JOB,
          { notificationId: row.id },
          {
            ...SEND_NOTIFICATION_JOB_OPTS,
            // Deterministic jobId: dedup by the same key as the producer
            // when present, otherwise fall back to the row id (BullMQ
            // rejects ':' inside jobId; mirror the swap done in
            // NotificationsService.toJobId).
            jobId: row.dedupKey
              ? `notif-${row.dedupKey.replace(/:/g, '_')}`
              : `notif-recover-${row.id}`,
          },
        );
        rescued += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to re-enqueue stuck notification ${row.id}: ${(err as Error).message}`,
        );
      }
    }

    if (rescued > 0) {
      this.logger.log(
        `Outbox safety net: re-enqueued ${rescued}/${stuck.length} stuck Notification(s).`,
      );
    }
    return rescued;
  }
}
