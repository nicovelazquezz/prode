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
}

/**
 * Service backing `/predictions/special` (Phase 7 Task 7.3).
 *
 * Ownership:
 *   - Cross-field invariants on the picks (champion / runnerUp / third must
 *     all be different teams when present);
 *   - The tournament-wide `lockedAt` check from spec 5.3 — once the
 *     inaugural match's predictions close, the cron sets `lockedAt` and any
 *     further mutation throws `SpecialPredictionLockedException`;
 *   - Audit logs (`special_prediction.created` / `special_prediction.updated`).
 *
 * The `(userId)` is the natural unique key — every user has at most one
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
   * Validates input and upserts the row keyed on `userId`.
   *
   * Edge case: `lockedAt` is checked against the EXISTING row (not the
   * input). If the user has no row yet AND the cron has already locked,
   * we still throw — using a quick `findUnique({ where: { userId } })`
   * isn't enough to cover that case, so we additionally check whether ANY
   * SpecialPrediction in the DB already has a non-null `lockedAt`. Cron
   * 5.3 sets all rows in a single UPDATE, so the presence of any locked
   * row means the inaugural match has already started and new rows must
   * be rejected too.
   */
  async upsertSpecialPrediction(
    userId: string,
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
      where: { userId },
    });

    if (existing?.lockedAt) {
      throw new SpecialPredictionLockedException();
    }

    // If the user has no row yet, check the global lock (spec 5.3 — cron
    // sets `lockedAt` on every existing row in one UPDATE; the absence of
    // any locked row at all means the inaugural match hasn't started, so
    // newcomers are still allowed). We only count when we have to so the
    // happy path stays at one query.
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
    // The row is keyed on userId (UNIQUE), so `upsert` on that key is the
    // natural fit. We pass each field through verbatim — `undefined` keeps
    // the previous value on update, which is what the partial DTO wants.
    const upserted = await this.prisma.specialPrediction.upsert({
      where: { userId },
      create: {
        userId,
        championTeamId: input.championTeamId,
        runnerUpTeamId: input.runnerUpTeamId,
        thirdPlaceTeamId: input.thirdPlaceTeamId,
        topScorerId: input.topScorerId,
        topScorerName: input.topScorerName,
        totalGoals: input.totalGoals,
      },
      update: {
        // `??` keeps existing values when the field is undefined, but
        // Prisma already does that natively for `undefined` — we still
        // pass undefined through so the PATCH semantics are explicit.
        championTeamId: input.championTeamId,
        runnerUpTeamId: input.runnerUpTeamId,
        thirdPlaceTeamId: input.thirdPlaceTeamId,
        topScorerId: input.topScorerId,
        topScorerName: input.topScorerName,
        totalGoals: input.totalGoals,
      },
    });

    void this.audit.log({
      userId,
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
          }
        : {
            championTeamId: upserted.championTeamId,
            runnerUpTeamId: upserted.runnerUpTeamId,
            thirdPlaceTeamId: upserted.thirdPlaceTeamId,
            topScorerId: upserted.topScorerId,
            topScorerName: upserted.topScorerName,
            totalGoals: upserted.totalGoals,
          },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return upserted;
  }

  /**
   * Returns the user's special prediction, or `null` if they haven't
   * created one yet. The `champion / runnerUp / thirdPlace` team relations
   * are included so the frontend can render flags and team names without
   * an extra round-trip.
   */
  async findForUser(userId: string): Promise<SpecialPrediction | null> {
    return this.prisma.specialPrediction.findUnique({
      where: { userId },
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
