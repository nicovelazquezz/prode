import {
  Body,
  Controller,
  ForbiddenException,
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
 * Multi-prode entry-scoped prediction endpoints. Mounts under
 * `/entries/:entryId/...` so the URL shape mirrors REST conventions
 * (the entryId is part of the resource path, not a header or query
 * param).
 *
 * Every handler validates that the resolved entry belongs to the
 * caller before delegating to the service. The legacy /predictions/...
 * controller still answers in parallel until the frontend rebinds
 * (Phase 9).
 */
@Controller('entries')
export class EntriesPredictionsController {
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

  private async assertOwnedEntry(
    userId: string,
    entryId: string,
  ): Promise<void> {
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
  }

  // ── Per-match prediction ────────────────────────────────────────────

  @Post(':entryId/predictions/match/:matchId')
  async createForMatch(
    @Param('entryId') entryId: string,
    @Param('matchId') matchId: string,
    @Body() dto: UpsertMatchPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    await this.assertOwnedEntry(me.id, entryId);
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

  @Put(':entryId/predictions/match/:matchId')
  async updateForMatch(
    @Param('entryId') entryId: string,
    @Param('matchId') matchId: string,
    @Body() dto: UpsertMatchPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    await this.assertOwnedEntry(me.id, entryId);
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

  @Get(':entryId/predictions')
  async listByEntry(
    @Param('entryId') entryId: string,
    @Query() query: ListMyPredictionsDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const me = this.requireUser(user);
    await this.assertOwnedEntry(me.id, entryId);
    return this.predictionsService.listEntryPredictions(entryId, {
      page: query.page,
      pageSize: query.pageSize,
      phase: query.phase,
    });
  }

  @Get(':entryId/predictions/match/:matchId')
  async getEntryPredictionForMatch(
    @Param('entryId') entryId: string,
    @Param('matchId') matchId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const me = this.requireUser(user);
    await this.assertOwnedEntry(me.id, entryId);
    return this.predictionsService.findEntryPrediction(entryId, matchId);
  }

  // ── Special prediction ──────────────────────────────────────────────

  @Post(':entryId/special')
  async createSpecial(
    @Param('entryId') entryId: string,
    @Body() dto: UpsertSpecialPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    await this.assertOwnedEntry(me.id, entryId);
    const ctx = { ...getRequestContext(req), userId: me.id };
    return this.specialPredictionsService.upsertSpecialPrediction(
      entryId,
      dto,
      ctx,
    );
  }

  @Put(':entryId/special')
  async updateSpecial(
    @Param('entryId') entryId: string,
    @Body() dto: UpsertSpecialPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    await this.assertOwnedEntry(me.id, entryId);
    const ctx = { ...getRequestContext(req), userId: me.id };
    return this.specialPredictionsService.upsertSpecialPrediction(
      entryId,
      dto,
      ctx,
    );
  }

  @Get(':entryId/special')
  async getSpecial(
    @Param('entryId') entryId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const me = this.requireUser(user);
    await this.assertOwnedEntry(me.id, entryId);
    return this.specialPredictionsService.findForEntry(entryId);
  }
}
