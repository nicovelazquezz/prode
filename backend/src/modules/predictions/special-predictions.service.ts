import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SpecialPredictionLockedException } from '../../common/exceptions/domain.exceptions.js';
import type { SpecialPrediction } from '../../../generated/prisma/client.js';

export interface UpsertSpecialPredictionInput {
  championTeamId?: string;
  runnerUpTeamId?: string;
  thirdPlaceTeamId?: string;
  topScorerId?: string;
  topScorerName?: string;
  totalGoals?: number;
}

interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
  /** Owning user id for audit anchoring; resolved by the caller. */
  userId?: string;
}

/**
 * Service backing the entry-scoped special prediction endpoints.
 *
 * Ownership:
 *   - Cross-field invariants on the picks (champion / runnerUp / third must
 *     all be different teams when present);
 *   - The tournament-wide `lockedAt` check from spec 5.3 — once the
 *     inaugural match's predictions close, the cron sets `lockedAt` and any
 *     further mutation throws `SpecialPredictionLockedException`;
 *   - Audit logs (`special_prediction.created` / `special_prediction.updated`).
 *
 * The `entryId` is the natural unique key — every entry has at most one
 * SpecialPrediction row, enforced by `@@unique` in Prisma. We do a
 * read-then-upsert in two queries so the audit row can carry a clean
 * before/after diff; the slim race window is acceptable noise (audit
 * only) and never produces an incorrect row.
 */
@Injectable()
export class SpecialPredictionsService {
  private readonly logger = new Logger(SpecialPredictionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validates input and upserts the row keyed on `entryId`.
   *
   * Edge case: `lockedAt` is checked against the EXISTING row (not the
   * input). If the entry has no row yet AND the cron has already locked,
   * we still throw — using a quick `findUnique({ where: { entryId } })`
   * isn't enough to cover that case, so we additionally check whether ANY
   * SpecialPrediction in the DB already has a non-null `lockedAt`.
   */
  async upsertSpecialPrediction(
    entryId: string,
    input: UpsertSpecialPredictionInput,
    ctx: AuditContext = {},
  ): Promise<SpecialPrediction> {
    // ── Cross-field validation ────────────────────────────────────
    this.assertDistinctTeams(input);
    if (input.totalGoals !== undefined && input.totalGoals <= 0) {
      throw new BadRequestException('totalGoals must be greater than zero');
    }
    if (
      input.topScorerId !== undefined &&
      input.topScorerId.trim().length === 0
    ) {
      throw new BadRequestException('topScorerId cannot be an empty string');
    }
    if (
      input.topScorerName !== undefined &&
      input.topScorerName.trim().length === 0
    ) {
      throw new BadRequestException('topScorerName cannot be an empty string');
    }

    const existing = await this.prisma.specialPrediction.findUnique({
      where: { entryId },
    });

    if (existing?.lockedAt) {
      throw new SpecialPredictionLockedException();
    }

    if (!existing) {
      const anyLocked = await this.prisma.specialPrediction.findFirst({
        where: { lockedAt: { not: null } },
        select: { id: true },
      });
      if (anyLocked) {
        throw new SpecialPredictionLockedException();
      }
    }

    // ── Persistence ──────────────────────────────────────────────
    const upserted = await this.prisma.specialPrediction.upsert({
      where: { entryId },
      create: {
        entryId,
        championTeamId: input.championTeamId,
        runnerUpTeamId: input.runnerUpTeamId,
        thirdPlaceTeamId: input.thirdPlaceTeamId,
        topScorerId: input.topScorerId,
        topScorerName: input.topScorerName,
        totalGoals: input.totalGoals,
      },
      update: {
        championTeamId: input.championTeamId,
        runnerUpTeamId: input.runnerUpTeamId,
        thirdPlaceTeamId: input.thirdPlaceTeamId,
        topScorerId: input.topScorerId,
        topScorerName: input.topScorerName,
        totalGoals: input.totalGoals,
      },
    });

    void this.audit.log({
      userId: ctx.userId,
      action: existing
        ? 'special_prediction.updated'
        : 'special_prediction.created',
      entity: 'special_prediction',
      entityId: upserted.id,
      changes: existing
        ? {
            before: {
              championTeamId: existing.championTeamId,
              runnerUpTeamId: existing.runnerUpTeamId,
              thirdPlaceTeamId: existing.thirdPlaceTeamId,
              topScorerId: existing.topScorerId,
              topScorerName: existing.topScorerName,
              totalGoals: existing.totalGoals,
            },
            after: {
              championTeamId: upserted.championTeamId,
              runnerUpTeamId: upserted.runnerUpTeamId,
              thirdPlaceTeamId: upserted.thirdPlaceTeamId,
              topScorerId: upserted.topScorerId,
              topScorerName: upserted.topScorerName,
              totalGoals: upserted.totalGoals,
            },
            entryId,
          }
        : {
            championTeamId: upserted.championTeamId,
            runnerUpTeamId: upserted.runnerUpTeamId,
            thirdPlaceTeamId: upserted.thirdPlaceTeamId,
            topScorerId: upserted.topScorerId,
            topScorerName: upserted.topScorerName,
            totalGoals: upserted.totalGoals,
            entryId,
          },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return upserted;
  }

  /**
   * Returns the entry's special prediction, or `null` if not created.
   * The `champion / runnerUp / thirdPlace` team relations are included
   * so the frontend can render flags and team names without an extra
   * round-trip.
   */
  async findForEntry(entryId: string): Promise<SpecialPrediction | null> {
    return this.prisma.specialPrediction.findUnique({
      where: { entryId },
      include: {
        championTeam: true,
        runnerUpTeam: true,
        thirdPlaceTeam: true,
        topScorer: true,
      },
    });
  }

  /** Throws `BadRequestException` if any two pick fields point to the same team. */
  private assertDistinctTeams(input: UpsertSpecialPredictionInput): void {
    const picks = [
      input.championTeamId,
      input.runnerUpTeamId,
      input.thirdPlaceTeamId,
    ].filter((id): id is string => Boolean(id));
    const set = new Set(picks);
    if (set.size !== picks.length) {
      throw new BadRequestException(
        'champion, runnerUp y thirdPlace deben referirse a equipos distintos',
      );
    }
  }
}
