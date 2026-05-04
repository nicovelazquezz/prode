import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { MatchesService } from './matches.service.js';
import { ListMatchesDto } from './dto/list-matches.dto.js';
import { UpdateMatchDto } from './dto/update-match.dto.js';
import { PostponeMatchDto } from './dto/postpone-match.dto.js';
import { Phase } from '../../../generated/prisma/enums.js';

/**
 * TTL applied to `GET /matches/upcoming`. The endpoint hits the DB at most
 * once every 5 minutes; correctness window is bounded by the 1-minute
 * auto-lock cron, which already sets a wider tolerance for stale data.
 */
const UPCOMING_TTL_MS = 5 * 60 * 1000;

function getRequestContext(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const uaHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return { ipAddress: req.ip ?? req.socket?.remoteAddress, userAgent };
}

/**
 * Public read-only matches endpoints. `@Public()` bypasses `JwtAuthGuard`
 * for the read paths; the admin sub-controller picks up auth + role checks.
 */
@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  @Public()
  @Get()
  async list(@Query() query: ListMatchesDto) {
    return this.matchesService.list({
      page: query.page,
      pageSize: query.pageSize,
      phase: query.phase,
      status: query.status,
      from: query.from,
      to: query.to,
    });
  }

  /**
   * Upcoming uses a manual cache-manager wrap rather than `@CacheInterceptor`
   * because the global `JwtAuthGuard` short-circuits before the interceptor
   * runs in some environments and the result shape is trivial.
   */
  @Public()
  @Get('upcoming')
  async upcoming() {
    const cacheKey = 'matches:upcoming:v1';
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;
    const fresh = await this.matchesService.upcoming();
    await this.cache.set(cacheKey, fresh, UPCOMING_TTL_MS);
    return fresh;
  }

  /**
   * Returns every match of a given phase with both team relations
   * populated. Useful for the bracket / group-stage views: when a team
   * isn't yet assigned, the relation is `null` but the row still carries
   * `homeTeamLabel` / `awayTeamLabel` placeholders for display.
   *
   * Path validation is manual (rather than via a DTO) because Nest's
   * `@Query` validators don't apply to path params; the explicit check
   * keeps the 400 response shape consistent.
   */
  @Public()
  @Get('by-phase/:phase')
  async byPhase(@Param('phase') phase: string) {
    if (!Object.values(Phase).includes(phase as Phase)) {
      throw new BadRequestException(
        `Unknown phase: ${phase}. Valid values: ${Object.values(Phase).join(', ')}`,
      );
    }
    return this.matchesService.byPhase(phase as Phase);
  }
}

/**
 * Admin-only match management endpoints. `JwtAuthGuard` runs globally;
 * `RolesGuard` is registered locally so we can require ADMIN without
 * affecting other routes that only need authentication.
 */
@Controller('admin/matches')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminMatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.matchesService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMatchDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const ctx = getRequestContext(req);
    return this.matchesService.update(id, dto, {
      userId: user?.id ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  @Post(':id/postpone')
  async postpone(
    @Param('id') id: string,
    @Body() dto: PostponeMatchDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const ctx = getRequestContext(req);
    return this.matchesService.postpone(id, dto.newKickoffAt, {
      userId: user?.id ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
