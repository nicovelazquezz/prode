import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { generateUniqueInviteCode } from './invite-code.js';
import type { CreateLeagueDto } from './dto/create-league.dto.js';
import type { League } from '../../../generated/prisma/client.js';

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
}
