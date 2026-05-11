import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { PredictionsService } from './predictions.service.js';
import { SpecialPredictionsService } from './special-predictions.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { UpsertMatchPredictionDto } from './dto/upsert-match-prediction.dto.js';
import { UpsertSpecialPredictionDto } from './dto/upsert-special-prediction.dto.js';
import { ListMyPredictionsDto } from './dto/list-my-predictions.dto.js';
import { matchPredictionCountCacheKey } from './match-predictions-public.controller.js';

function getRequestContext(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const uaHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return { ipAddress: req.ip ?? req.socket?.remoteAddress, userAgent };
}

/**
 * Authenticated prediction endpoints. The global `JwtAuthGuard` runs by
 * default — every handler here needs a logged-in user.
 *
 * Both `POST` and `PUT` are exposed for the same upsert operation so
 * REST-purist clients can use whichever they prefer; the underlying
 * service does the same `(entryId, matchId)` write either way.
 *
 * Multi-prode interim: the legacy `/predictions/...` paths target the
 * user's primary (lowest-position) entry. Task 5.6 rebinds them to
 * `/entries/:entryId/predictions/...` once the frontend is ready.
 */
@Controller('predictions')
export class PredictionsController {
  constructor(
    private readonly predictionsService: PredictionsService,
    private readonly specialPredictionsService: SpecialPredictionsService,
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private async invalidateMatchCount(matchId: string): Promise<void> {
    await this.cache.del(matchPredictionCountCacheKey(matchId));
  }

  private requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }

  /**
   * Resolves the primary (lowest-position) ACTIVE entry for the user.
   * Used by the legacy `/predictions/...` paths until Task 5.6 rebinds
   * them. Throws 404 if the user has no entry — every payer has Entry #1
   * created at registration; the only callers that hit this without an
   * entry are the admin and any user whose registration is incomplete.
   */
  private async resolvePrimaryEntryId(userId: string): Promise<string> {
    const entry = await this.prisma.entry.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!entry) {
      throw new NotFoundException(
        'No active entry found for user — pay an inscription first',
      );
    }
    return entry.id;
  }

  @Post('match/:matchId')
  async createForMatch(
    @Param('matchId') matchId: string,
    @Body() dto: UpsertMatchPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const entryId = await this.resolvePrimaryEntryId(me.id);
    const ctx = { ...getRequestContext(req), userId: me.id };
    const result = await this.predictionsService.upsertMatchPrediction(
      entryId,
      matchId,
      dto,
      ctx,
    );
    await this.invalidateMatchCount(matchId);
    return result;
  }

  @Put('match/:matchId')
  async updateForMatch(
    @Param('matchId') matchId: string,
    @Body() dto: UpsertMatchPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const entryId = await this.resolvePrimaryEntryId(me.id);
    const ctx = { ...getRequestContext(req), userId: me.id };
    const result = await this.predictionsService.upsertMatchPrediction(
      entryId,
      matchId,
      dto,
      ctx,
    );
    await this.invalidateMatchCount(matchId);
    return result;
  }

  @Get('me')
  async listMine(
    @Query() query: ListMyPredictionsDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const me = this.requireUser(user);
    const entryId = await this.resolvePrimaryEntryId(me.id);
    return this.predictionsService.listEntryPredictions(entryId, {
      page: query.page,
      pageSize: query.pageSize,
      phase: query.phase,
    });
  }

  @Get('me/match/:matchId')
  async getMineForMatch(
    @Param('matchId') matchId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const me = this.requireUser(user);
    const entryId = await this.resolvePrimaryEntryId(me.id);
    return this.predictionsService.findEntryPrediction(entryId, matchId);
  }

  // ── Special predictions ────────────────────────────────────────────

  @Post('special')
  async createSpecial(
    @Body() dto: UpsertSpecialPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const entryId = await this.resolvePrimaryEntryId(me.id);
    const ctx = { ...getRequestContext(req), userId: me.id };
    return this.specialPredictionsService.upsertSpecialPrediction(
      entryId,
      dto,
      ctx,
    );
  }

  @Put('special')
  async updateSpecial(
    @Body() dto: UpsertSpecialPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const entryId = await this.resolvePrimaryEntryId(me.id);
    const ctx = { ...getRequestContext(req), userId: me.id };
    return this.specialPredictionsService.upsertSpecialPrediction(
      entryId,
      dto,
      ctx,
    );
  }

  @Get('special/me')
  async getMySpecial(@CurrentUser() user: AuthenticatedUser | undefined) {
    const me = this.requireUser(user);
    const entryId = await this.resolvePrimaryEntryId(me.id);
    return this.specialPredictionsService.findForEntry(entryId);
  }
}
