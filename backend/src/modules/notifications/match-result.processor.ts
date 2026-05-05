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

const OUTCOME_LABEL: Record<OutcomeType, string> = {
  EXACT: 'resultado exacto',
  WINNER_AND_DIFF: 'ganador + diferencia',
  WINNER_ONLY: 'solo ganador',
  DRAW_DIFFERENT: 'empate distinto',
  MISS: 'sin acierto',
};

/**
 * Handler for the `match-result` job. Fans out a WhatsApp recap to every
 * entry that scored points on the just-finished match.
 *
 * Multi-prode: predictions are by entry, not user. A user with multiple
 * prodes that all scored on the same match gets one notification per
 * entry — the alias / "prode #N" suffix in the message body tells them
 * which one. The rank suffix uses the per-entry rank from the MV.
 *
 * DedupKey: `match-result:${entryId}:${matchId}`.
 */
@Injectable()
export class MatchResultProcessor {
  private readonly logger = new Logger(MatchResultProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

    // Only notify scoring entries whose owning user is ACTIVE + opted in.
    const winningPredictions = await this.prisma.prediction.findMany({
      where: {
        matchId,
        pointsEarned: { gt: 0 },
        entry: {
          status: 'ACTIVE',
          user: {
            status: 'ACTIVE',
            whatsappOptIn: true,
          },
        },
      },
      orderBy: { pointsEarned: 'desc' },
      select: {
        entryId: true,
        pointsEarned: true,
        outcomeType: true,
        entry: {
          select: {
            position: true,
            alias: true,
            user: { select: { id: true, whatsapp: true } },
          },
        },
      },
    });

    if (winningPredictions.length === 0) {
      this.logger.log(
        `match-result: no scoring entries for match ${matchId} — nothing to send.`,
      );
      return 0;
    }

    const rankByEntry = await this.fetchRanksFor(
      winningPredictions.map((p) => p.entryId),
    );

    let enqueued = 0;
    for (const pred of winningPredictions) {
      const label = pred.outcomeType
        ? OUTCOME_LABEL[pred.outcomeType]
        : 'puntos sumados';

      const entryRank = rankByEntry.get(pred.entryId);
      const rankSuffix = entryRank
        ? ` Estás en la posición #${entryRank.rank} con ${entryRank.total} pts.`
        : '';

      const aliasInfix = pred.entry.alias
        ? ` con tu prode "${pred.entry.alias}"`
        : pred.entry.position > 1
          ? ` con tu prode #${pred.entry.position}`
          : '';

      const message =
        `🎯 Sumaste ${pred.pointsEarned} pts${aliasInfix} en ` +
        `${homeName} ${match.scoreHome}-${match.scoreAway} ${awayName} ` +
        `(${label}).${rankSuffix}`;

      try {
        await this.notifications.enqueue({
          userId: pred.entry.user.id,
          toAddress: pred.entry.user.whatsapp,
          type: 'MATCH_RESULT',
          title: 'Resultado del partido',
          message,
          channel: 'WHATSAPP',
          dedupKey: `match-result:${pred.entryId}:${matchId}`,
        });
        enqueued += 1;
      } catch (err) {
        this.logger.warn(
          `match-result enqueue failed entry=${pred.entryId} match=${matchId}: ${
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
   * Returns a Map<entryId, { rank, total }> sourced from the
   * `leaderboard_global` MV. Best-effort: any error is swallowed and an
   * empty map returned.
   */
  private async fetchRanksFor(
    entryIds: string[],
  ): Promise<Map<string, { rank: number; total: number }>> {
    const map = new Map<string, { rank: number; total: number }>();
    if (entryIds.length === 0) return map;
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ entry_id: string; rank: bigint; total_points: bigint }>
      >`
        WITH ranked AS (
          SELECT
            entry_id,
            total_points,
            ROW_NUMBER() OVER (
              ORDER BY total_points DESC, exact_count DESC, hits_count DESC
            ) AS rank
          FROM leaderboard_global
        )
        SELECT entry_id, rank, total_points
        FROM ranked
        WHERE entry_id = ANY (${entryIds}::text[])
      `;
      for (const r of rows) {
        map.set(r.entry_id, {
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
