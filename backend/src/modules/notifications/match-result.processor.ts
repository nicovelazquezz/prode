import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import type { OutcomeType } from '../../../generated/prisma/enums.js';

/**
 * BullMQ job name produced by `ScoringService.finishMatchAndScore` /
 * `recalculateMatch`. Routed to this handler from `NotificationsProcessor`
 * (single-worker pattern, same as `OrphanAlertProcessor` /
 * `LeaderboardRefreshProcessor`).
 */
export const MATCH_RESULT_JOB = 'match-result';

export interface MatchResultJobData {
  matchId: string;
}

/**
 * Pretty Spanish labels for `outcomeType` so the WhatsApp message reads
 * naturally. We deliberately do NOT include MISS — the worker only
 * notifies users who SUMARON pts, and MISS by definition is 0 pts.
 */
const OUTCOME_LABEL: Record<OutcomeType, string> = {
  EXACT: 'resultado exacto',
  WINNER_AND_DIFF: 'ganador + diferencia',
  WINNER_ONLY: 'solo ganador',
  DRAW_DIFFERENT: 'empate distinto',
  MISS: 'sin acierto',
};

/**
 * Handler for the `match-result` job. Fans out a WhatsApp recap to every
 * user that scored points on the just-finished match.
 *
 * Why a handler class instead of a `@Processor` decorator: see the doc
 * comment on `OrphanAlertProcessor` — only one BullMQ worker per queue,
 * so we route by `job.name` inside the existing `NotificationsProcessor`
 * and let this class encapsulate the recap behaviour.
 *
 * Behaviour:
 *   1. Read the match (with team relations + final score).
 *   2. Read predictions ordered by `pointsEarned DESC`.
 *   3. For every prediction with `pointsEarned > 0` whose user is ACTIVE
 *      and `whatsappOptIn=true`, enqueue a WhatsApp Notification with
 *      dedupKey `match-result:${userId}:${matchId}` (so retries / a
 *      recálculo of the same match don't double-send).
 *
 * The user's leaderboard rank is computed from the materialized view
 * `leaderboard_global` for richer messaging. If the lookup fails (MV
 * not refreshed yet, or user not present), the message gracefully falls
 * back to "Sumaste X pts" without the rank suffix.
 */
@Injectable()
export class MatchResultProcessor {
  private readonly logger = new Logger(MatchResultProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Returns the count of Notifications enqueued. Helpful in tests. */
  async handle(job: Job<MatchResultJobData>): Promise<number> {
    const { matchId } = job.data;
    if (!matchId) {
      this.logger.warn(
        `match-result job ${job.id} missing matchId — skipping`,
      );
      return 0;
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        scoreHome: true,
        scoreAway: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        homeTeamLabel: true,
        awayTeamLabel: true,
      },
    });
    if (!match) {
      this.logger.warn(`match-result: match ${matchId} not found — skipping`);
      return 0;
    }
    if (match.scoreHome === null || match.scoreAway === null) {
      this.logger.warn(
        `match-result: match ${matchId} has no scores — skipping`,
      );
      return 0;
    }

    const homeName = match.homeTeam?.name ?? match.homeTeamLabel ?? 'Local';
    const awayName = match.awayTeam?.name ?? match.awayTeamLabel ?? 'Visitante';

    // Only notify scoring users. Order DESC for nicer log output, plus
    // it's the natural sort if anyone reads the audit later.
    const winningPredictions = await this.prisma.prediction.findMany({
      where: {
        matchId,
        pointsEarned: { gt: 0 },
        user: {
          status: 'ACTIVE',
          whatsappOptIn: true,
        },
      },
      orderBy: { pointsEarned: 'desc' },
      select: {
        userId: true,
        pointsEarned: true,
        outcomeType: true,
        user: {
          select: { whatsapp: true },
        },
      },
    });

    if (winningPredictions.length === 0) {
      this.logger.log(
        `match-result: no scoring users for match ${matchId} — nothing to send.`,
      );
      return 0;
    }

    // Pull the rank/total table once. The MV is the canonical source for
    // global leaderboard standings — querying predictions live would be
    // expensive at scale and inconsistent with what the user sees on
    // the dashboard. If the MV is stale or missing the row, we just
    // omit the rank from the message body (best effort).
    const rankByUser = await this.fetchRanksFor(
      winningPredictions.map((p) => p.userId),
    );

    let enqueued = 0;
    for (const pred of winningPredictions) {
      const label = pred.outcomeType
        ? OUTCOME_LABEL[pred.outcomeType]
        : 'puntos sumados';

      const userRank = rankByUser.get(pred.userId);
      const rankSuffix = userRank
        ? ` Estás en la posición #${userRank.rank} con ${userRank.total} pts.`
        : '';

      const message =
        `🎯 Sumaste ${pred.pointsEarned} pts en ` +
        `${homeName} ${match.scoreHome}-${match.scoreAway} ${awayName} ` +
        `(${label}).${rankSuffix}`;

      try {
        await this.notifications.enqueue({
          userId: pred.userId,
          toAddress: pred.user.whatsapp,
          type: 'MATCH_RESULT',
          title: 'Resultado del partido',
          message,
          channel: 'WHATSAPP',
          dedupKey: `match-result:${pred.userId}:${matchId}`,
        });
        enqueued += 1;
      } catch (err) {
        this.logger.warn(
          `match-result enqueue failed user=${pred.userId} match=${matchId}: ${
            (err as Error).message
          }`,
        );
      }
    }

    this.logger.log(
      `match-result: enqueued ${enqueued} recap(s) for match ${matchId}.`,
    );
    return enqueued;
  }

  /**
   * Returns a Map<userId, { rank, total }> sourced from the
   * `leaderboard_global` materialized view. The MV exposes
   * `total_points` per user; we layer a `ROW_NUMBER()` window for the
   * rank (1-based, ordered by the same composite key as the public
   * leaderboard) and filter to just the userIds we need at the end.
   *
   * Best-effort: any error is swallowed and an empty map returned. The
   * recap message gracefully drops the rank suffix in that case.
   */
  private async fetchRanksFor(
    userIds: string[],
  ): Promise<Map<string, { rank: number; total: number }>> {
    const map = new Map<string, { rank: number; total: number }>();
    if (userIds.length === 0) return map;
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ user_id: string; rank: bigint; total_points: bigint }>
      >`
        WITH ranked AS (
          SELECT
            user_id,
            total_points,
            ROW_NUMBER() OVER (
              ORDER BY total_points DESC, exact_count DESC, hits_count DESC
            ) AS rank
          FROM leaderboard_global
        )
        SELECT user_id, rank, total_points
        FROM ranked
        WHERE user_id = ANY (${userIds}::text[])
      `;
      for (const r of rows) {
        map.set(r.user_id, {
          rank: Number(r.rank),
          total: Number(r.total_points),
        });
      }
    } catch (err) {
      this.logger.warn(
        `match-result: leaderboard_global rank lookup failed: ${
          (err as Error).message
        }`,
      );
    }
    return map;
  }
}
