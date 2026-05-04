import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
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
 * the ladder without a login. The `me/around` and `league/:id` paths
 * require auth — the latter additionally checks league membership.
 */
@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly service: LeaderboardService,
    // Used by the league endpoint to assert membership before delegating.
    // Kept here (not in the service) so the service stays free of HTTP
    // policy and the membership check produces a 403 with a clean stack.
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Public global ladder, paged. Returns `{ rows, total }` so the client
   * can render a progress bar / total-pages indicator without an extra
   * count request.
   */
  @Public()
  @Get('global')
  async global(@Query() query: LeaderboardPageDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    return this.service.getGlobal(page, pageSize);
  }

  /**
   * Public per-phase ladder. Same shape as `/global`, but filtered to
   * predictions whose match belongs to the given phase. Phase is a
   * route param (not a query) so caches cleanly key on URL.
   *
   * Path validation here is manual because Nest's `@Query` validators
   * don't auto-cover `@Param`. We mirror the matches controller's
   * pattern for consistency in the 400 response.
   */
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
   * Authenticated "around me" — returns up to `2n + 1` rows centred on
   * the caller's rank. Always uncached on the service side because the
   * slice is per-user.
   */
  @Get('me/around')
  async meAround(
    @Query() query: LeaderboardAroundDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    const n = query.n ?? DEFAULT_AROUND_N;
    return this.service.getMyAround(user.id, n);
  }

  /**
   * Authenticated per-league ladder. The caller must be a member of the
   * league — anything else returns 403, even for ADMIN role. Admins who
   * need cross-league visibility should query the underlying tables
   * directly (operational concern, not a feature surface).
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

    // Membership check via the unique (leagueId, userId) index. A single
    // round-trip; if missing we 403. We don't check league existence
    // separately — a non-existent leagueId can't have a membership for
    // the caller, which is the same shape as "league exists, you're not
    // in it" from the user's POV.
    const membership = await this.prisma.leagueMembership.findUnique({
      where: {
        leagueId_userId: {
          leagueId,
          userId: user.id,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this league');
    }

    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    return this.service.getByLeague(leagueId, page, pageSize);
  }
}
