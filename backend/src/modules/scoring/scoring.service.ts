import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ScoringConfigService } from './scoring-config.service.js';
import { PhaseService } from './phase.service.js';
import { classifyOutcome } from './classify-outcome.js';
import {
  MatchAlreadyFinishedException,
  PhaseAlreadyPaidException,
} from '../../common/exceptions/domain.exceptions.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';
import type { Match } from '../../../generated/prisma/client.js';

/**
 * BullMQ job names produced by the scoring flow. Routed by the
 * dispatching `NotificationsProcessor` (and, for `leaderboard.refresh`,
 * the `LeaderboardRefreshProcessor` registered there in Task 8.9).
 */
export const LEADERBOARD_REFRESH_JOB = 'leaderboard.refresh';
export const LEADERBOARD_REFRESH_DEDUP_KEY = 'leaderboard:refresh';
export const MATCH_RESULT_JOB = 'match-result';

/**
 * Orchestrates the "admin loaded a result" flow described in spec 6.3.
 *
 * The hot path is `finishMatchAndScore`:
 *   1. Pre-checks (status != FINISHED, phase not already paid out) outside
 *      any TX so the user gets fast 4xx feedback when they're blocked.
 *   2. Resolve scoring rules + phase multiplier from cache.
 *   3. One Prisma TX with a 30-second timeout: update the match (with
 *      `status: { not: 'FINISHED' }` guard so a concurrent admin call
 *      can't double-score), pull the predictions, score them sequentially
 *      (Prisma TX shares ONE pooled connection — Promise.all here would
 *      either serialise anyway or throw connection-busy), then write the
 *      audit log.
 *   4. POST-COMMIT side effects: enqueue `leaderboard.refresh` (deduped
 *      via stable `jobId`), enqueue `match-result` (consumed by Phase 11
 *      worker), and call `phaseService.maybeClosePhase` (Task 8.7).
 *
 * `recalculateMatch` mirrors the same shape but pivots the guard rails:
 * the match MUST be FINISHED, and we record before/after scores in the
 * audit log so the trail can answer "what changed and when".
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringConfig: ScoringConfigService,
    private readonly phaseService: PhaseService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {}

  async finishMatchAndScore(
    matchId: string,
    scoreHome: number,
    scoreAway: number,
    adminUserId: string,
  ): Promise<Match> {
    // ── Pre-checks (outside TX) ────────────────────────────────────────
    const matchPrev = await this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
    });
    if (matchPrev.status === 'FINISHED') {
      throw new MatchAlreadyFinishedException();
    }
    const phaseWinner = await this.prisma.phaseWinner.findUnique({
      where: { phase: matchPrev.phase },
    });
    if (phaseWinner?.prizeStatus === 'PAID') {
      throw new PhaseAlreadyPaidException();
    }

    const rules = await this.scoringConfig.getRules();
    const multipliers = await this.scoringConfig.getMultipliers();
    const multiplier = multipliers[matchPrev.phase];

    // ── Atomic update + scoring ───────────────────────────────────────
    let predictionsScored = 0;
    let updated: Match | null = null;
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Atomic guard: if a concurrent caller already FINISHED this
        //    match, this update affects 0 rows and Prisma throws —
        //    Promise rejects, TX rolls back, we surface a 400 from the
        //    pre-check on retry. Cleaner than a SELECT … FOR UPDATE.
        updated = await tx.match.update({
          where: { id: matchId, status: { not: 'FINISHED' } },
          data: {
            scoreHome,
            scoreAway,
            status: 'FINISHED',
            finishedAt: new Date(),
          },
        });

        // 2. Pull every prediction for this match.
        const predictions = await tx.prediction.findMany({
          where: { matchId },
        });
        predictionsScored = predictions.length;

        // 3. Sequential update — Prisma TX shares one pooled connection.
        //    Promise.all here would either serialise anyway or throw
        //    "Transaction already closed" on a busy connection.
        for (const p of predictions) {
          const outcomeType = classifyOutcome(
            { scoreHome: p.scoreHome, scoreAway: p.scoreAway },
            { scoreHome, scoreAway },
          );
          const basePoints = rules[outcomeType] ?? 0;
          const pointsEarned = Math.round(basePoints * multiplier);
          await tx.prediction.update({
            where: { id: p.id },
            data: {
              outcomeType,
              basePoints,
              multiplier,
              pointsEarned,
              evaluatedAt: new Date(),
            },
          });
        }

        // 4. Audit row inside the same TX so it commits atomically with
        //    the rest. The interceptor-driven audit log is for HTTP
        //    side-effects; this is the domain event of record.
        await tx.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'match.finished',
            entity: 'match',
            entityId: matchId,
            changes: {
              score: { home: scoreHome, away: scoreAway },
              predictionsScored: predictions.length,
            },
          },
        });
      },
      { timeout: 30_000 },
    );

    // ── POST-COMMIT side effects ──────────────────────────────────────
    // Refresh the leaderboard MV asynchronously. `jobId` provides
    // BullMQ-level dedup: two finishes in quick succession share one
    // pending refresh.
    await this.enqueueLeaderboardRefresh();
    // Fan-out match-result notifications (Phase 11 worker).
    await this.notificationsQueue.add(MATCH_RESULT_JOB, { matchId });
    // Phase progression hook (full impl arrives in Task 8.7).
    await this.phaseService.maybeClosePhase(matchPrev.phase);

    this.logger.log(
      `Match ${matchId} finished: scored ${predictionsScored} predictions, multiplier=${multiplier}`,
    );

    return updated!;
  }

  /**
   * Internal helper: enqueues the dedup'd MV refresh. Extracted so the
   * recalculate path (Task 8.5) reuses the same call.
   */
  private async enqueueLeaderboardRefresh(): Promise<void> {
    await this.notificationsQueue.add(
      LEADERBOARD_REFRESH_JOB,
      {},
      {
        jobId: LEADERBOARD_REFRESH_DEDUP_KEY,
        removeOnComplete: true,
      },
    );
  }
}
