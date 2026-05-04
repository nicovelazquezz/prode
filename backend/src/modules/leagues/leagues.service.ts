import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { generateUniqueInviteCode } from './invite-code.js';
import type { CreateLeagueDto } from './dto/create-league.dto.js';
import type { League } from '../../../generated/prisma/client.js';
import {
  AlreadyLeagueMemberException,
  LeagueFullException,
} from '../../common/exceptions/domain.exceptions.js';

interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

/** Default mirror of `League.maxMembers` — kept in sync with the schema. */
const DEFAULT_MAX_MEMBERS = 50;

/**
 * Shape returned by {@link LeaguesService.listForUser}. Augments the
 * `League` row with the membership count + `isOwner` flag the frontend
 * needs to render the "Mis ligas" list without a second round-trip.
 */
export interface LeagueListEntry extends League {
  memberCount: number;
  isOwner: boolean;
}

/**
 * Domain logic for mini-leagues. The controller stays thin — this service
 * owns the invite-code generation, the owner-as-first-member transaction,
 * and the audit-log emission.
 *
 * Audit logs go through {@link AuditService.log} (not the `@Audit`
 * interceptor) because we need `entityId` on the freshly-created league
 * row, which doesn't exist when the interceptor reads `request.params`.
 */
@Injectable()
export class LeaguesService {
  private readonly logger = new Logger(LeaguesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a league and the owner's membership in a single transaction.
   * The `inviteCode` is generated up-front (before the TX opens) so a
   * collision retry doesn't extend the lock window — the unique
   * constraint at insert time would catch the rare race anyway.
   */
  async createLeague(
    ownerId: string,
    dto: CreateLeagueDto,
    ctx: AuditContext = {},
  ): Promise<League> {
    const inviteCode = await generateUniqueInviteCode(this.prisma);

    const league = await this.prisma.$transaction(async (tx) => {
      const created = await tx.league.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          inviteCode,
          ownerId,
          isPublic: dto.isPublic ?? false,
          maxMembers: dto.maxMembers ?? DEFAULT_MAX_MEMBERS,
          // Auto-add the owner as a member. Doing it inside the create
          // via the relation keeps everything in one statement under the
          // same TX — the unique (leagueId, userId) index makes the
          // implicit insert safe.
          members: {
            create: { userId: ownerId },
          },
        },
      });
      return created;
    });

    void this.audit.log({
      userId: ownerId,
      action: 'league.created',
      entity: 'league',
      entityId: league.id,
      changes: {
        name: league.name,
        description: league.description,
        isPublic: league.isPublic,
        maxMembers: league.maxMembers,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return league;
  }

  /**
   * Lists every league the user is a member of, augmented with
   * `memberCount` (so the UI can show "12 / 50" badges) and `isOwner`
   * (controls the edit button). Uses Prisma's relation `_count` instead
   * of a per-row count query so the whole listing is a single statement.
   */
  async listForUser(userId: string): Promise<LeagueListEntry[]> {
    const leagues = await this.prisma.league.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        _count: {
          select: { members: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return leagues.map((league) => {
      const { _count, ...rest } = league;
      return {
        ...rest,
        memberCount: _count.members,
        isOwner: rest.ownerId === userId,
      };
    });
  }

  /**
   * Joins the caller to the league identified by `inviteCode`. The DTO
   * already upper-cases + validates shape; here we just look up + check
   * the four invariants that demand a DB round-trip:
   *
   *   1. League exists                      → 404
   *   2. memberCount < maxMembers           → 409 LEAGUE_FULL
   *   3. caller not already a member        → 409 ALREADY_LEAGUE_MEMBER
   *   4. otherwise insert the membership row
   *
   * Implementation notes:
   *   - Uses a single `findUnique` on `inviteCode` with an inline
   *     `_count` to avoid a separate count query; the index on
   *     `inviteCode` (unique) makes this cheap.
   *   - The capacity + duplicate-member checks happen in JS before the
   *     insert. There IS a race window where two concurrent joins could
   *     both clear the cap check — mitigation: the `(leagueId, userId)`
   *     unique constraint catches duplicates, and the `maxMembers` race
   *     can at worst result in `members === maxMembers + 1` for one
   *     transaction. Acceptable at the spec's scale; tightening would
   *     require advisory locks (overkill for <200 leagues).
   *   - Audit log via {@link AuditService.log} (not the @Audit
   *     interceptor) for the same reason as `createLeague`: we want
   *     `entityId` set to the league id, not the membership id.
   */
  async joinLeague(
    userId: string,
    inviteCode: string,
    ctx: AuditContext = {},
  ): Promise<League> {
    const league = await this.prisma.league.findUnique({
      where: { inviteCode },
      include: { _count: { select: { members: true } } },
    });
    if (!league) {
      throw new NotFoundException('League not found for the given invite code');
    }

    if (league._count.members >= league.maxMembers) {
      throw new LeagueFullException();
    }

    const existingMembership = await this.prisma.leagueMembership.findUnique({
      where: { leagueId_userId: { leagueId: league.id, userId } },
      select: { id: true },
    });
    if (existingMembership) {
      throw new AlreadyLeagueMemberException();
    }

    await this.prisma.leagueMembership.create({
      data: { leagueId: league.id, userId },
    });

    void this.audit.log({
      userId,
      action: 'league.joined',
      entity: 'league',
      entityId: league.id,
      changes: { inviteCode },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    // Strip the `_count` key so the public payload matches the shape
    // returned by `createLeague` (a plain `League`, not the include
    // result).
    const { _count, ...rest } = league;
    void _count;
    return rest;
  }
}
