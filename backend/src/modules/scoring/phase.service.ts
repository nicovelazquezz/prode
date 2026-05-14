import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MatchProgressionService } from './match-progression.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';
import type { Phase } from '../../../generated/prisma/enums.js';

/**
 * BullMQ job name for the phase-winner notification (consumed by Phase
 * 11 worker that fans out the WhatsApp/email to the winner).
 */
export const PHASE_WINNER_JOB = 'phase-winner';

/**
 * Result of `computePhaseWinner` — the entry that scored the most points
 * across the matches of the closing phase, with the tie-break columns
 * exposed so the audit log can show "won by exact_count" if relevant.
 *
 * Multi-prode (post v1.1): rankings are by entry, not user. The owning
 * user is resolved downstream from `Entry.userId` for notifications.
 */
export interface PhaseWinnerCandidate {
  entryId: string;
  points: number;
  exactCount: number;
  hitsCount: number;
}

/**
 * Phase-progression orchestrator. Runs at the end of every
 * `finishMatchAndScore` / `recalculateMatch` and, when the closing
 * match was the last pending one of its phase:
 *
 *   1. Compute the phase winner with FIFA-style tie-breakers
 *      (points DESC → exact predictions DESC → total hits DESC).
 *   2. Insert a `PhaseWinner` row + audit log inside one TX.
 *      Idempotent: re-entry sees the row and no-ops.
 *   3. Trigger the next-phase populator
 *      (`MatchProgressionService.populateRound32Matches`, etc.).
 *   4. Enqueue the `phase-winner` notification for the winning user.
 *
 * The single trigger point (called from inside scoring) avoids the race
 * condition you'd get from a parallel cron — two callers could both pass
 * the "PhaseWinner doesn't exist" check and both insert. Spec section 6.4.
 */
@Injectable()
export class PhaseService {
  private readonly logger = new Logger(PhaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progression: MatchProgressionService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {}

  /**
   * Closes a phase iff every match in the phase is FINISHED and no
   * `PhaseWinner` row exists yet. No-op otherwise.
   *
   * Idempotency: callers (finishMatchAndScore, recalculateMatch) can
   * fire this on every score update — only the last call (the one that
   * brought the pending count to 0) actually does work.
   */
  async maybeClosePhase(phase: Phase): Promise<void> {
    const pending = await this.prisma.match.count({
      where: { phase, status: { not: 'FINISHED' } },
    });
    if (pending > 0) {
      this.logger.debug(
        `Phase ${phase} still has ${pending} pending matches — not closing`,
      );
      return;
    }

    const existing = await this.prisma.phaseWinner.findUnique({
      where: { phase },
    });
    if (existing) {
      this.logger.debug(
        `Phase ${phase} already closed (winnerEntry=${existing.entryId})`,
      );
      return;
    }

    const winner = await this.computePhaseWinner(phase);
    if (!winner) {
      // Edge case: no predictions exist for this phase (e.g. a brand-new
      // tournament with no users yet). Log it but don't crash; the admin
      // can manually create a PhaseWinner if they ever want to declare
      // a winner retroactively.
      this.logger.warn(
        `Phase ${phase} has no predictions to score — skipping PhaseWinner creation`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.phaseWinner.create({
        data: {
          phase,
          entryId: winner.entryId,
          pointsEarned: winner.points,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'phase.closed',
          entity: 'phase',
          entityId: phase,
          changes: {
            winner: {
              entryId: winner.entryId,
              points: winner.points,
              exactCount: winner.exactCount,
              hitsCount: winner.hitsCount,
            },
          },
        },
      });
    });

    this.logger.log(
      `Closed phase ${phase}: winnerEntry=${winner.entryId} points=${winner.points}`,
    );

    // ── Populate the next phase. The frontend reveals matches once
    // homeTeamId/awayTeamId are non-null, so this hand-off unlocks
    // predictions for the next round.
    if (phase === 'GROUPS') await this.progression.populateRound32Matches();
    if (phase === 'ROUND_32') await this.progression.populateRound16Matches();
    if (phase === 'ROUND_16') await this.progression.populateQuarterMatches();
    if (phase === 'QUARTERS') await this.progression.populateSemiMatches();
    if (phase === 'SEMIS') await this.progression.populateFinalMatches();
    // THIRD_PLACE / FINAL have no follow-up to populate.

    // Note: el WhatsApp automático al ganador de fase se eliminó
    // intencionalmente (decisión permanente, no gated por flag — ver
    // spec 2026-05-14-wa-limit-mass-sends-design.md). El admin contacta
    // a los ganadores desde su WhatsApp personal. La PhaseWinner row
    // sigue siendo creada para audit y cálculo de premios.
  }

  /**
   * Computes the top scorer of a phase based on every prediction whose
   * match belongs to that phase, with two tie-breakers:
   *
   *   1. Higher exact predictions (count of `outcomeType = 'EXACT'`).
   *   2. Higher total hits (any outcomeType other than MISS).
   *
   * Returns `null` when no predictions exist (e.g. brand-new DB).
   *
   * Implemented as a single raw SQL query so we get the aggregation +
   * tie-break ordering in one round-trip. The Prisma model API would
   * either need 3 separate aggregate calls (one per tie-break column)
   * or a downstream JS sort — both more code, both slower.
   */
  async computePhaseWinner(phase: Phase): Promise<PhaseWinnerCandidate | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        entryId: string;
        points: bigint;
        exact_count: bigint;
        hits_count: bigint;
      }>
    >`
      SELECT
        p."entryId" AS "entryId",
        SUM(p."pointsEarned")::bigint AS points,
        COUNT(*) FILTER (WHERE p."outcomeType" = 'EXACT')::bigint AS exact_count,
        COUNT(*) FILTER (WHERE p."outcomeType" IN ('EXACT','WINNER_AND_DIFF','WINNER_ONLY','DRAW_DIFFERENT'))::bigint AS hits_count
      FROM predictions p
      INNER JOIN matches m ON m.id = p."matchId"
      INNER JOIN entries e ON e.id = p."entryId" AND e.status = 'ACTIVE'
      WHERE m.phase = ${phase}::"Phase"
        AND p."evaluatedAt" IS NOT NULL
      GROUP BY p."entryId"
      ORDER BY points DESC, exact_count DESC, hits_count DESC
      LIMIT 1;
    `;

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      entryId: r.entryId,
      points: Number(r.points),
      exactCount: Number(r.exact_count),
      hitsCount: Number(r.hits_count),
    };
  }
}
