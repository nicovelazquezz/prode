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
  /**
   * Owning user id. Predictions live on entries (post multi-prode); the
   * audit row still anchors to the human user so admins can search by
   * person. Caller resolves it (controller / job).
   */
  userId?: string;
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

export interface ListEntryPredictionsParams {
  page?: number;
  pageSize?: number;
  phase?: Phase;
}

export interface PaginatedEntryPredictions {
  data: unknown[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Service backing the entry-scoped prediction endpoints. Owns:
 *   - lock-window enforcement (`now() < match.predictionsLockAt`);
 *   - score range validation (defence-in-depth, also in DTO);
 *   - the `(entryId, matchId)` upsert that powers both POST and PUT verbs;
 *   - audit logs (`prediction.created` / `prediction.updated`).
 *
 * Cache invalidation is handled by the controller so the service stays
 * cache-agnostic and unit-testable without a Cache instance.
 *
 * Authorization: callers MUST resolve `entryId` from a user-owned entry
 * before invoking these methods. The service does not re-validate
 * ownership; controller / guard does.
 */
@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Upserts the entry's prediction for a single match. Returns the resulting
   * row. Does NOT include the match relation by default — callers that need
   * it should re-fetch via {@link findEntryPrediction}.
   */
  async upsertMatchPrediction(
    entryId: string,
    matchId: string,
    input: UpsertMatchPredictionInput,
    ctx: AuditContext = {},
  ): Promise<Prediction> {
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

    if (Date.now() >= match.predictionsLockAt.getTime()) {
      throw new PredictionLockedException();
    }

    const existing = await this.prisma.prediction.findUnique({
      where: { entryId_matchId: { entryId, matchId } },
      select: { id: true, scoreHome: true, scoreAway: true },
    });

    const upserted = await this.prisma.prediction.upsert({
      where: { entryId_matchId: { entryId, matchId } },
      create: {
        entryId,
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
      userId: ctx.userId,
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
            entryId,
            matchId,
          }
        : {
            scoreHome: upserted.scoreHome,
            scoreAway: upserted.scoreAway,
            entryId,
            matchId,
          },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return upserted;
  }

  /**
   * Lists every prediction for a single entry, joined with the underlying
   * match (and both team relations) so the frontend can render score +
   * opponent in a single payload. Sorted by `match.kickoffAt` ASC.
   */
  async listEntryPredictions(
    entryId: string,
    params: ListEntryPredictionsParams = {},
  ): Promise<PaginatedEntryPredictions> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    const where: { entryId: string; match?: { phase: Phase } } = { entryId };
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
   * Returns the entry's prediction for a single match — `null` if not
   * created. The frontend uses this to pre-fill the input when the user
   * revisits a match's prediction page.
   */
  async findEntryPrediction(
    entryId: string,
    matchId: string,
  ): Promise<Prediction | null> {
    return this.prisma.prediction.findUnique({
      where: { entryId_matchId: { entryId, matchId } },
      include: {
        match: {
          include: { homeTeam: true, awayTeam: true },
        },
      },
    });
  }

  /**
   * Counts how many entries have submitted a prediction for the given
   * match. Public counter, used to fuel "X usuarios ya predijeron este
   * partido" badges in the frontend. Returns 0 if the match doesn't
   * exist — choosing not to 404 keeps the call safe behind a 60 s cache.
   */
  async countForMatch(matchId: string): Promise<number> {
    return this.prisma.prediction.count({ where: { matchId } });
  }
}
