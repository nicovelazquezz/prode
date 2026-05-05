import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { Phase } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LeaderboardPageDto } from './dto/leaderboard-page.dto.js';
import { LeaderboardAroundDto } from './dto/leaderboard-around.dto.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_AROUND_N = 5;

/**
 * Public + authenticated leaderboard reads (spec section 9). The global
 * and per-phase listings stay unauthenticated so the home page can show
 * the ladder without a login. The `entry/:entryId/around` and
 * `league/:id` paths require auth.
 *
 * Multi-prode: rows describe entries (one row per entry, not per user).
 * The `me/around` legacy path resolves the caller's primary entry and
 * forwards to the new entry-scoped query, so existing clients keep
 * working until the frontend switches to the new endpoint.
 */
@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly service: LeaderboardService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('global')
  async global(@Query() query: LeaderboardPageDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    return this.service.getGlobal(page, pageSize);
  }

  @Public()
  @Get('phase/:phase')
  async byPhase(
    @Param('phase') phase: string,
    @Query() query: LeaderboardPageDto,
  ) {
    if (!Object.values(Phase).includes(phase as Phase)) {
      throw new BadRequestException(
        `Unknown phase: ${phase}. Valid values: ${Object.values(Phase).join(', ')}`,
      );
    }
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    return this.service.getByPhase(phase as Phase, page, pageSize);
  }

  /**
   * "Around" a specific entry. The entry must belong to the caller —
   * sharing your friend's around-rank is intentionally not a public
   * feature.
   */
  @Get('entry/:entryId/around')
  async entryAround(
    @Param('entryId') entryId: string,
    @Query() query: LeaderboardAroundDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    await this.assertOwnedEntry(user.id, entryId);
    const n = query.n ?? DEFAULT_AROUND_N;
    return this.service.getEntryAround(entryId, n);
  }

  /**
   * Legacy /me/around — resolves the user's primary entry and forwards.
   * Kept until the frontend rebinds to /entry/:entryId/around.
   */
  @Get('me/around')
  async meAround(
    @Query() query: LeaderboardAroundDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    const entry = await this.prisma.entry.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!entry) {
      throw new NotFoundException('No active entry for user');
    }
    const n = query.n ?? DEFAULT_AROUND_N;
    return this.service.getEntryAround(entry.id, n);
  }

  /**
   * Authenticated per-league ladder. The caller must have at least one
   * entry in the league; we still check by entry now.
   */
  @Get('league/:leagueId')
  async byLeague(
    @Param('leagueId') leagueId: string,
    @Query() query: LeaderboardPageDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Membership check: any of the caller's entries is enough to grant
    // visibility on the league ladder.
    const membership = await this.prisma.leagueMembership.findFirst({
      where: {
        leagueId,
        entry: { userId: user.id },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this league');
    }

    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    return this.service.getByLeague(leagueId, page, pageSize);
  }

  private async assertOwnedEntry(
    userId: string,
    entryId: string,
  ): Promise<void> {
    const entry = await this.prisma.entry.findUnique({
      where: { id: entryId },
      select: { userId: true, status: true },
    });
    if (!entry) {
      throw new NotFoundException(`Entry ${entryId} not found`);
    }
    if (entry.userId !== userId) {
      throw new ForbiddenException('Entry does not belong to user');
    }
  }
}
