import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PredictionLockedException } from '../../common/exceptions/domain.exceptions.js';
import type { Prediction } from '../../../generated/prisma/client.js';
import type { Phase } from '../../../generated/prisma/enums.js';

/**
 * DTO-shape consumed by `upsertMatchPrediction`. The controller's class-
 * validator DTO already enforces the same bounds; the service re-checks
 * defensively because it can be called from places other than the HTTP
 * layer (e.g. a future bulk import or admin tool) where the DTO does not
 * run.
 */
export interface UpsertMatchPredictionInput {
  scoreHome: number;
  scoreAway: number;
}

interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Maximum allowed score for a single team. The seed data uses up to ~10
 * goals; 99 is a generous upper bound that fits in a smallint and matches
 * the DTO validator. Spec section 5.2.
 */
const MAX_SCORE = 99;

/** Default and maximum page sizes for `GET /predictions/me`. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

export interface ListUserPredictionsParams {
  page?: number;
  pageSize?: number;
  phase?: Phase;
}

export interface PaginatedUserPredictions {
  data: unknown[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Service backing `/predictions/match/:matchId` (Phase 7 task 7.1). Owns:
 *   - lock-window enforcement (`now() < match.predictionsLockAt`);
 *   - score range validation (defence-in-depth, also in DTO);
 *   - the `(userId, matchId)` upsert that powers both POST and PUT verbs;
 *   - audit logs (`prediction.created` / `prediction.updated`).
 *
 * Cache invalidation is handled by the controller (Task 7.6) so the service
 * stays cache-agnostic and unit-testable without a Cache instance.
 */
@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Upserts the user's prediction for a single match. Returns the resulting
   * row. Does NOT include the match relation by default — callers that need
   * it should re-fetch via {@link findUserPrediction}.
   */
  async upsertMatchPrediction(
    userId: string,
    matchId: string,
    input: UpsertMatchPredictionInput,
    ctx: AuditContext = {},
  ): Promise<Prediction> {
    // Server-side range check. Mirrors the DTO @Min/@Max so non-HTTP
    // callers can't bypass the validator.
    if (
      !Number.isInteger(input.scoreHome) ||
      !Number.isInteger(input.scoreAway) ||
      input.scoreHome < 0 ||
      input.scoreAway < 0 ||
      input.scoreHome > MAX_SCORE ||
      input.scoreAway > MAX_SCORE
    ) {
      throw new BadRequestException(
        `Scores must be integers between 0 and ${MAX_SCORE}`,
      );
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, predictionsLockAt: true },
    });
    if (!match) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }

    // Lock window: predictions close 10 minutes before kickoff (spec 5.3).
    // We compare to the row's stored `predictionsLockAt` rather than
    // recomputing from kickoff so an admin-edited lock time is honoured.
    if (Date.now() >= match.predictionsLockAt.getTime()) {
      throw new PredictionLockedException();
    }

    // Was there already a prediction? We need to know to pick the audit
    // action. `findUnique` on the composite unique avoids racing with the
    // upsert below — even if a parallel request creates the row between the
    // two queries, the upsert still does the right thing; only the audit
    // action might say `created` for what's effectively an update, which is
    // acceptable noise.
    const existing = await this.prisma.prediction.findUnique({
      where: { userId_matchId: { userId, matchId } },
      select: { id: true, scoreHome: true, scoreAway: true },
    });

    const upserted = await this.prisma.prediction.upsert({
      where: { userId_matchId: { userId, matchId } },
      create: {
        userId,
        matchId,
        scoreHome: input.scoreHome,
        scoreAway: input.scoreAway,
      },
      update: {
        scoreHome: input.scoreHome,
        scoreAway: input.scoreAway,
      },
    });

    void this.audit.log({
      userId,
      action: existing ? 'prediction.updated' : 'prediction.created',
      entity: 'prediction',
      entityId: upserted.id,
      changes: existing
        ? {
            before: {
              scoreHome: existing.scoreHome,
              scoreAway: existing.scoreAway,
            },
            after: {
              scoreHome: upserted.scoreHome,
              scoreAway: upserted.scoreAway,
            },
            matchId,
          }
        : {
            scoreHome: upserted.scoreHome,
            scoreAway: upserted.scoreAway,
            matchId,
          },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return upserted;
  }

  /**
   * Lists every prediction the user has loaded, joined with the underlying
   * match (and both team relations) so the frontend can render score +
   * opponent in a single payload. Sorted by `match.kickoffAt` ASC so the
   * caller sees their own predictions in chronological order.
   */
  async listUserPredictions(
    userId: string,
    params: ListUserPredictionsParams = {},
  ): Promise<PaginatedUserPredictions> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    // Filtering by phase requires going through the match relation. Prisma
    // supports the nested `match: { phase }` filter natively.
    const where: { userId: string; match?: { phase: Phase } } = { userId };
    if (params.phase) {
      where.match = { phase: params.phase };
    }

    const [data, total] = await Promise.all([
      this.prisma.prediction.findMany({
        where,
        include: {
          match: {
            include: { homeTeam: true, awayTeam: true },
          },
        },
        orderBy: { match: { kickoffAt: 'asc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.prediction.count({ where }),
    ]);

    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Returns the user's prediction for a single match — `null` if they
   * haven't loaded one yet. The frontend uses this to pre-fill the input
   * when the user revisits a match's prediction page.
   */
  async findUserPrediction(
    userId: string,
    matchId: string,
  ): Promise<Prediction | null> {
    return this.prisma.prediction.findUnique({
      where: { userId_matchId: { userId, matchId } },
      include: {
        match: {
          include: { homeTeam: true, awayTeam: true },
        },
      },
    });
  }
}
