import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  MatchStatus,
  Phase,
} from '../../../generated/prisma/enums.js';
import type { Match } from '../../../generated/prisma/client.js';

/**
 * Default page size for `GET /matches`. Covers a single matchday (12 group
 * matches max per day) comfortably while keeping payloads small.
 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

/**
 * Lock window before kickoff: predictions close 10 minutes before whistle.
 * Spec section 5.3 — this is the source of truth for `predictionsLockAt`.
 */
const LOCK_WINDOW_MS = 10 * 60 * 1000;

export interface ListMatchesParams {
  page?: number;
  pageSize?: number;
  phase?: Phase;
  status?: MatchStatus;
  from?: string;
  to?: string;
}

export interface UpdateMatchParams {
  kickoffAt?: string;
  venue?: string;
  city?: string;
  country?: string;
  homeTeamId?: string;
  awayTeamId?: string;
}

export interface PaginatedMatches {
  data: Match[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface AuditContext {
  userId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Service backing the `/matches` and `/admin/matches` endpoints. Centralises
 * the domain invariants from spec section 5.3:
 *
 *   - `predictionsLockAt = kickoffAt − 10 min` (recomputed on every kickoff
 *     edit through {@link recomputeLockAt}).
 *   - When both teams flip from null → not-null in a single update, the
 *     match opens for predictions (`predictionsOpenAt = now()`).
 *
 * Stays close to Prisma without leaking model types; the controller is
 * thin and lets DTO/ValidationPipe enforce shape.
 */
@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Helper consumed by the update path. Kept private + named for the spec
   * (5.3 calls it `recomputeLockAt`); unit-tested via a thin getter.
   */
  private recomputeLockAt(kickoffAt: Date): Date {
    return new Date(kickoffAt.getTime() - LOCK_WINDOW_MS);
  }

  /**
   * Test-only accessor for the helper. Marked `internal` so it doesn't show
   * up in IDE autocomplete from outside the package.
   *
   * @internal
   */
  recomputeLockAtForTest(kickoffAt: Date): Date {
    return this.recomputeLockAt(kickoffAt);
  }

  // ── Public read ──────────────────────────────────────────────────────

  /**
   * Lists matches with pagination + optional filters. Sorted by `kickoffAt`
   * ASC by default (chronological). The total count is computed in the
   * same call so the caller can render a pager.
   */
  async list(params: ListMatchesParams): Promise<PaginatedMatches> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    const where: {
      phase?: Phase;
      status?: MatchStatus;
      kickoffAt?: { gte?: Date; lt?: Date };
    } = {};
    if (params.phase) where.phase = params.phase;
    if (params.status) where.status = params.status;
    if (params.from || params.to) {
      where.kickoffAt = {};
      if (params.from) where.kickoffAt.gte = new Date(params.from);
      if (params.to) where.kickoffAt.lt = new Date(params.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.match.findMany({
        where,
        orderBy: { kickoffAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { homeTeam: true, awayTeam: true },
      }),
      this.prisma.match.count({ where }),
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
   * Returns the next 10 SCHEDULED matches whose kickoff is still in the
   * future. The controller layers a 5-minute cache on top of this; the
   * service stays cache-agnostic so tests can call it directly.
   */
  async upcoming(): Promise<Match[]> {
    return this.prisma.match.findMany({
      where: {
        status: MatchStatus.SCHEDULED,
        kickoffAt: { gt: new Date() },
      },
      orderBy: { kickoffAt: 'asc' },
      take: 10,
      include: { homeTeam: true, awayTeam: true },
    });
  }

  /**
   * Lists matches of a single phase with both team relations populated. The
   * frontend uses this to render brackets and group standings; team labels
   * (e.g. "Eq A1") are still in the row when the relation is null.
   */
  async byPhase(phase: Phase): Promise<Match[]> {
    return this.prisma.match.findMany({
      where: { phase },
      orderBy: { kickoffAt: 'asc' },
      include: { homeTeam: true, awayTeam: true },
    });
  }

  /**
   * Admin detail endpoint — joins both team relations so the panel can
   * render flags / names without an extra round-trip.
   */
  async findOne(id: string): Promise<Match> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!match) {
      throw new NotFoundException(`Match ${id} not found`);
    }
    return match;
  }

  // ── Admin writes ─────────────────────────────────────────────────────

  /**
   * Updates an admin-editable subset of a match. Enforces the domain
   * invariants from section 5.3:
   *
   *   - kickoff edits recompute `predictionsLockAt` automatically;
   *   - a kickoff in the past is rejected with 400 (admin sets future
   *     dates only — past results are loaded via the dedicated scoring
   *     endpoint in Phase 8);
   *   - assigning the same team to both sides is rejected with 400;
   *   - assigning both teams when previously unassigned opens the match
   *     for predictions (`predictionsOpenAt = now()`).
   *
   * Emits one audit row per call with the most relevant action — kickoff
   * edits and team assignments cannot meaningfully share an action key, so
   * we prioritise team-assignment when both happen in the same payload.
   */
  async update(
    id: string,
    body: UpdateMatchParams,
    ctx: AuditContext = {},
  ): Promise<Match> {
    const existing = await this.prisma.match.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Match ${id} not found`);
    }

    const data: Parameters<typeof this.prisma.match.update>[0]['data'] = {};
    let action: 'match.kickoff_updated' | 'match.team_assigned' | 'match.updated' =
      'match.updated';

    if (body.kickoffAt !== undefined) {
      const next = new Date(body.kickoffAt);
      if (Number.isNaN(next.getTime())) {
        throw new BadRequestException('kickoffAt is not a valid ISO date');
      }
      if (next.getTime() <= Date.now()) {
        throw new BadRequestException('kickoffAt must be in the future');
      }
      if (next.getTime() !== existing.kickoffAt.getTime()) {
        data.kickoffAt = next;
        data.predictionsLockAt = this.recomputeLockAt(next);
        action = 'match.kickoff_updated';
      }
    }

    if (body.venue !== undefined) data.venue = body.venue;
    if (body.city !== undefined) data.city = body.city;
    if (body.country !== undefined) data.country = body.country;

    const teamFieldsTouched =
      body.homeTeamId !== undefined || body.awayTeamId !== undefined;
    let teamsAssignedForFirstTime = false;

    if (teamFieldsTouched) {
      const nextHome = body.homeTeamId ?? existing.homeTeamId;
      const nextAway = body.awayTeamId ?? existing.awayTeamId;
      if (nextHome && nextAway && nextHome === nextAway) {
        throw new BadRequestException(
          'homeTeamId and awayTeamId must reference different teams',
        );
      }
      if (body.homeTeamId !== undefined) data.homeTeamId = body.homeTeamId;
      if (body.awayTeamId !== undefined) data.awayTeamId = body.awayTeamId;

      const wereBothNull =
        existing.homeTeamId === null && existing.awayTeamId === null;
      const willBothBeSet = !!nextHome && !!nextAway;
      if (wereBothNull && willBothBeSet) {
        data.predictionsOpenAt = new Date();
        teamsAssignedForFirstTime = true;
      }
      if (
        action !== 'match.kickoff_updated' &&
        (existing.homeTeamId !== nextHome || existing.awayTeamId !== nextAway)
      ) {
        action = 'match.team_assigned';
      }
    }

    if (Object.keys(data).length === 0) {
      // No-op — return the existing row to keep the response shape stable.
      return existing;
    }

    const updated = await this.prisma.match.update({
      where: { id },
      data,
    });

    void this.audit.log({
      userId: ctx.userId,
      action,
      entity: 'match',
      entityId: id,
      changes: {
        before: {
          kickoffAt: existing.kickoffAt,
          predictionsLockAt: existing.predictionsLockAt,
          homeTeamId: existing.homeTeamId,
          awayTeamId: existing.awayTeamId,
          venue: existing.venue,
          city: existing.city,
          country: existing.country,
        },
        after: data,
        teamsAssignedForFirstTime,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /**
   * Postpones a match: status → POSTPONED, kickoff updated, lock recomputed.
   * The new kickoff must be in the future (admin only postpones forward).
   * Already-FINISHED matches cannot be postponed (the result is canonical).
   */
  async postpone(
    id: string,
    newKickoffAt: string,
    ctx: AuditContext = {},
  ): Promise<Match> {
    const existing = await this.prisma.match.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Match ${id} not found`);
    }
    if (existing.status === MatchStatus.FINISHED) {
      throw new BadRequestException(
        'Cannot postpone a match that has already finished',
      );
    }

    const next = new Date(newKickoffAt);
    if (Number.isNaN(next.getTime())) {
      throw new BadRequestException('newKickoffAt is not a valid ISO date');
    }
    if (next.getTime() <= Date.now()) {
      throw new BadRequestException('newKickoffAt must be in the future');
    }

    const updated = await this.prisma.match.update({
      where: { id },
      data: {
        kickoffAt: next,
        predictionsLockAt: this.recomputeLockAt(next),
        status: MatchStatus.POSTPONED,
      },
    });

    void this.audit.log({
      userId: ctx.userId,
      action: 'match.postponed',
      entity: 'match',
      entityId: id,
      changes: {
        from: {
          kickoffAt: existing.kickoffAt,
          status: existing.status,
        },
        to: {
          kickoffAt: next,
          status: MatchStatus.POSTPONED,
        },
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /**
   * Cancela un partido: status → CANCELLED. Pensado para casos en que
   * el organizador (FIFA, etc.) decide que el partido no se juega — distinto
   * de `postpone` que mueve a una fecha nueva. No pedimos `reason` porque
   * la decisión es externa al sistema; el audit log registra la transición.
   *
   * No se puede cancelar un partido FINISHED (el resultado es canónico —
   * usar `recalculateMatch` para corregir scores). Idempotente si ya está
   * CANCELLED. Las predicciones existentes quedan intactas: como `scoring`
   * solo se dispara en transiciones a FINISHED, nunca se les asignan
   * puntos y el leaderboard las ignora.
   */
  async cancel(id: string, ctx: AuditContext = {}): Promise<Match> {
    const existing = await this.prisma.match.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Match ${id} not found`);
    }
    if (existing.status === MatchStatus.FINISHED) {
      throw new BadRequestException(
        'Cannot cancel a match that has already finished',
      );
    }
    if (existing.status === MatchStatus.CANCELLED) {
      // Idempotente: ya está cancelado, nada que actualizar.
      return existing;
    }

    const updated = await this.prisma.match.update({
      where: { id },
      data: { status: MatchStatus.CANCELLED },
    });

    void this.audit.log({
      userId: ctx.userId,
      action: 'match.cancelled',
      entity: 'match',
      entityId: id,
      changes: {
        from: { status: existing.status },
        to: { status: MatchStatus.CANCELLED },
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }
}
