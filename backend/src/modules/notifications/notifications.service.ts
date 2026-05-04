import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  NOTIFICATIONS_QUEUE,
  SEND_NOTIFICATION_JOB,
  SEND_NOTIFICATION_JOB_OPTS,
} from './notifications.constants.js';
import type {
  NotificationChannel,
  NotificationType,
  Notification,
} from '../../../generated/prisma/client.js';

export interface EnqueueNotificationArgs {
  userId?: string | null;
  /**
   * Recipient address. Format depends on `channel`:
   *   - WHATSAPP → E.164-ish phone number ("549...")
   *   - EMAIL    → email address
   *   - IN_APP   → may be null (the row itself is the delivery)
   */
  toAddress: string | null;
  type: NotificationType;
  title: string;
  message: string;
  channel: NotificationChannel;
  /**
   * Stable key for de-duplication. When provided, repeated calls with
   * the same key are coalesced into a single Notification row AND a
   * single BullMQ job (BullMQ uses jobId for de-dup as well).
   */
  dedupKey?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Outbox-style notifications service.
 *
 * Two integration patterns are supported:
 *
 *   1) Fire-and-forget — `enqueue(args)` creates the Notification row
 *      and adds the BullMQ job in one shot. Use this from non-transactional
 *      code paths.
 *
 *   2) Outbox / runOnCommit — `enqueueAfterCommit(args)`. The CALLER is
 *      responsible for performing its DB writes inside a Prisma TX, then
 *      awaiting the TX commit, then calling this method. We do NOT add
 *      the BullMQ job inside the TX because BullMQ writes to Redis (a
 *      separate system) — if Redis writes succeed and the TX rolls back,
 *      we'd be sending notifications for events that never happened.
 *      A Phase 4-future cron sweeps stuck PENDING rows as a safety net.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * One-shot: persist Notification (or upsert by dedupKey) and queue the
   * worker job. Both writes happen in the order DB → Redis; if the Redis
   * write fails the row is left PENDING and will be picked up by the
   * future safety-net cron.
   */
  async enqueue(args: EnqueueNotificationArgs): Promise<Notification> {
    const notification = await this.persist(args);
    await this.addJob(notification.id, args.dedupKey);
    return notification;
  }

  /**
   * Outbox helper. Documents the post-commit pattern: the caller has
   * already committed their TX, and now we publish the side effect.
   * Functionally identical to `enqueue` today; kept as a separate
   * method so call sites read clearly and we can attach extra
   * post-commit semantics later (e.g. tracing, retry budgets) without
   * changing every caller.
   */
  async enqueueAfterCommit(args: EnqueueNotificationArgs): Promise<Notification> {
    return this.enqueue(args);
  }

  /**
   * Internal: create-or-upsert the Notification row. dedupKey is the
   * unique index in the schema; using upsert here guarantees that
   * idempotent retries from upstream callers do not produce dupes.
   */
  private async persist(args: EnqueueNotificationArgs): Promise<Notification> {
    const baseData = {
      userId: args.userId ?? null,
      toAddress: args.toAddress,
      type: args.type,
      title: args.title,
      message: args.message,
      channel: args.channel,
      status: 'PENDING' as const,
      metadata: (args.metadata ?? undefined) as
        | Parameters<typeof this.prisma.notification.create>[0]['data']['metadata']
        | undefined,
    };

    if (args.dedupKey) {
      return this.prisma.notification.upsert({
        where: { dedupKey: args.dedupKey },
        // On dup we deliberately do NOTHING beyond what's already there —
        // the original row's status/attempts must be preserved, otherwise
        // a SENT notification could get re-triggered.
        update: {},
        create: { ...baseData, dedupKey: args.dedupKey },
      });
    }

    return this.prisma.notification.create({ data: baseData });
  }

  /**
   * Enqueues the dedup'd `leaderboard.refresh` job on the shared
   * notifications queue. Mirrors the post-commit helper in
   * `ScoringService` (which keeps it private to the scoring module's
   * locally-registered queue) so other producers — like the admin
   * manual-refresh endpoint (Phase 9) — don't need to register their
   * own BullMQ queue. Re-registering the queue via
   * `BullModule.registerQueue` outside this module clobbers the local
   * tokens registered by `ScoringModule`/`PaymentsModule` (the global
   * ordering wins), so we centralise leaderboard refresh enqueueing
   * here where the queue is already wired.
   *
   * Returns the job id (always the constant dedup id) so the caller
   * can echo it to the user/log.
   */
  async enqueueLeaderboardRefresh(): Promise<string> {
    const jobId = 'leaderboard_refresh';
    await this.queue.add(
      'leaderboard.refresh',
      {},
      { jobId, removeOnComplete: true },
    );
    return jobId;
  }

  /**
   * Internal: enqueue the BullMQ job. Uses dedupKey as jobId so a job
   * for an already-queued notification is rejected by BullMQ — second
   * line of defence on top of the DB unique index.
   */
  private async addJob(
    notificationId: string,
    dedupKey: string | undefined,
  ): Promise<void> {
    try {
      const job = await this.queue.add(
        SEND_NOTIFICATION_JOB,
        { notificationId },
        {
          ...SEND_NOTIFICATION_JOB_OPTS,
          ...(dedupKey ? { jobId: this.toJobId(dedupKey) } : {}),
        },
      );
      this.logger.debug(
        `Enqueued ${SEND_NOTIFICATION_JOB} job=${job.id} for notification=${notificationId}`,
      );
    } catch (err) {
      // Don't blow up the caller — the row is already PENDING in the DB
      // and will be picked up by the safety-net cron (Phase 7+).
      this.logger.warn(
        `Failed to enqueue ${SEND_NOTIFICATION_JOB} job for notification ${notificationId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * BullMQ rejects custom job ids containing ':' because that character
   * is reserved for its internal Redis key namespacing. We swap colons
   * (commonly used in domain-style dedup keys like `orphan:pay_42`) for
   * '_' so any caller-chosen dedup key is accepted.
   */
  private toJobId(dedupKey: string): string {
    return `notif-${dedupKey.replace(/:/g, '_')}`;
  }
}
