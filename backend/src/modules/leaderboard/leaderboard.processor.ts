import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Job name produced by `ScoringService.finishMatchAndScore` /
 * `recalculateMatch` for the materialized-view refresh. Routed to this
 * handler from `NotificationsProcessor` (single-worker pattern, mirrors
 * `OrphanAlertProcessor`).
 */
export const LEADERBOARD_REFRESH_JOB = 'leaderboard.refresh';

/**
 * Handler for the `leaderboard.refresh` job. Issues a
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global` so the
 * dashboard sees the new pointsEarned values within ~1-2s of a score
 * update.
 *
 * Why a handler class instead of a `@Processor` decorator: the
 * `notifications` BullMQ queue already has its own worker
 * (`NotificationsProcessor`). Spinning a second worker on the same
 * queue creates a scheduling race — both workers compete for every
 * job and silently drop the ones whose name they don't recognise.
 * Routing by job name inside the existing worker is the safe
 * pattern; this class encapsulates the refresh behaviour so it stays
 * unit-testable on its own.
 *
 * `CONCURRENTLY` requires a unique index on the MV (we have
 * `leaderboard_global_user_id_idx`). It allows reads to continue
 * while the refresh runs, at the cost of a brief disk-bandwidth spike;
 * for the <200-user scale of this app the spike is negligible.
 *
 * Errors propagate so BullMQ records the failure and triggers the
 * configured backoff/retry. The job dedup id (`leaderboard_refresh`)
 * makes BullMQ coalesce concurrent producer calls into a single
 * pending job; a retry of a failed refresh therefore doesn't fan out
 * to multiple parallel REFRESHes.
 */
@Injectable()
export class LeaderboardRefreshProcessor {
  private readonly logger = new Logger(LeaderboardRefreshProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(job: Job): Promise<void> {
    if (job.name !== LEADERBOARD_REFRESH_JOB) return;

    const start = Date.now();
    // The MV is a Prisma-unaware Postgres object — `$executeRaw` is the
    // right escape hatch. Postgres requires a transaction for `REFRESH
    // MATERIALIZED VIEW CONCURRENTLY`, but `$executeRaw` already runs
    // each statement in an implicit single-statement transaction, so
    // we don't need to wrap it explicitly.
    await this.prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
    const ms = Date.now() - start;
    this.logger.log(`Refreshed leaderboard_global in ${ms}ms (job=${job.id})`);
  }
}
