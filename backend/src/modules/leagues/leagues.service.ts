import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

export interface LeagueListEntry extends League {
  memberCount: number;
  isOwner: boolean;
  /**
   * Which of the caller's entries is currently a member. The frontend
   * needs this to render the leaderboard slice for the right entry.
   * Null only if the caller is owner-only and has no entry in the league
   * (rare/edge — a league created via legacy flow before backfill).
   */
  myEntryId: string | null;
}

/**
 * Domain logic for mini-leagues. Multi-prode: leagues are owned by a
 * User but membership is by Entry. A user with multiple prodes picks
 * which entry joins (creating, joining, displaying). The owner's
 * "creating" entry is auto-joined when they create the league.
 */
@Injectable()
export class LeaguesService {
  private readonly logger = new Logger(LeaguesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolves the entry to use for a league op. If `entryId` is provided
   * we validate ownership; otherwise we pick the caller's primary
   * (lowest-position, ACTIVE) entry. Throws 403 / 404 with consistent
   * codes so the controller doesn't have to.
   */
  private async resolveEntryForUser(
    userId: string,
    entryId: string | undefined,
  ): Promise<string> {
    if (entryId) {
      const entry = await this.prisma.entry.findUnique({
        where: { id: entryId },
        select: { id: true, userId: true, status: true },
      });
      if (!entry) {
        throw new NotFoundException(`Entry ${entryId} not found`);
      }
      if (entry.userId !== userId) {
        throw new ForbiddenException('Entry does not belong to user');
      }
      if (entry.status !== 'ACTIVE') {
        throw new ForbiddenException('Entry is not active');
      }
      return entry.id;
    }
    const primary = await this.prisma.entry.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!primary) {
      throw new NotFoundException(
        'No active entry for user — pay an inscription first',
      );
    }
    return primary.id;
  }

  /**
   * Creates a league and auto-joins the owner's chosen entry. The owner
   * stays the human user (so "Juan creó la liga" reads naturally even
   * if Juan has 5 prodes); only the membership is by entry.
   */
  async createLeague(
    ownerId: string,
    dto: CreateLeagueDto & { entryId?: string },
    ctx: AuditContext = {},
  ): Promise<League> {
    const entryId = await this.resolveEntryForUser(ownerId, dto.entryId);
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
          // Auto-add the owner's chosen entry as the first member.
          members: {
            create: { entryId },
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
        ownerEntryId: entryId,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return league;
  }

  /**
   * Lists every league the user has at least one entry in. Augments
   * each row with `memberCount`, `isOwner`, and `myEntryId` (the
   * caller's entry inside the league). When the user has multiple
   * entries in the same league we pick the lowest-position one for
   * `myEntryId` — the rest are still members, just displayed elsewhere.
   */
  async listForUser(userId: string): Promise<LeagueListEntry[]> {
    const leagues = await this.prisma.league.findMany({
      where: {
        members: {
          some: { entry: { userId } },
        },
      },
      include: {
        _count: {
          select: { members: true },
        },
        members: {
          where: { entry: { userId } },
          include: { entry: { select: { id: true, position: true } } },
          orderBy: { entry: { position: 'asc' } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return leagues.map((league) => {
      const { _count, members, ...rest } = league;
      const myMembership = members[0];
      return {
        ...rest,
        memberCount: _count.members,
        isOwner: rest.ownerId === userId,
        myEntryId: myMembership?.entry?.id ?? null,
      };
    });
  }

  /**
   * Joins the caller's chosen entry to the league identified by
   * `inviteCode`. The DTO already upper-cases + validates shape; here
   * we look up + check the four invariants that demand a DB round-trip:
   *
   *   1. League exists                          → 404
   *   2. memberCount < maxMembers               → 409 LEAGUE_FULL
   *   3. entry not already a member             → 409 ALREADY_LEAGUE_MEMBER
   *   4. otherwise insert the membership row
   *
   * Note: a single user CAN have two entries in the same league
   * (paid twice, plays both prodes in the same group). The unique
   * `(leagueId, entryId)` enforces no double-join of the SAME entry.
   */
  async joinLeague(
    userId: string,
    inviteCode: string,
    entryId: string | undefined,
    ctx: AuditContext = {},
  ): Promise<League> {
    const resolvedEntryId = await this.resolveEntryForUser(userId, entryId);

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
      where: {
        leagueId_entryId: { leagueId: league.id, entryId: resolvedEntryId },
      },
      select: { id: true },
    });
    if (existingMembership) {
      throw new AlreadyLeagueMemberException();
    }

    await this.prisma.leagueMembership.create({
      data: { leagueId: league.id, entryId: resolvedEntryId },
    });

    void this.audit.log({
      userId,
      action: 'league.joined',
      entity: 'league',
      entityId: league.id,
      changes: { inviteCode, entryId: resolvedEntryId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const { _count, ...rest } = league;
    void _count;
    return rest;
  }
}
