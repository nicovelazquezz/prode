import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { PredictionsService } from './predictions.service.js';
import { SpecialPredictionsService } from './special-predictions.service.js';
import { UpsertMatchPredictionDto } from './dto/upsert-match-prediction.dto.js';
import { UpsertSpecialPredictionDto } from './dto/upsert-special-prediction.dto.js';
import { ListMyPredictionsDto } from './dto/list-my-predictions.dto.js';

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
 * default — every handler here needs a logged-in user, so none of the
 * routes are marked `@Public()`.
 *
 * Both `POST` and `PUT` are exposed for the same upsert operation so
 * REST-purist clients can use whichever they prefer; the underlying
 * service does the same `(userId, matchId)` write either way.
 */
@Controller('predictions')
export class PredictionsController {
  constructor(
    private readonly predictionsService: PredictionsService,
    private readonly specialPredictionsService: SpecialPredictionsService,
  ) {}

  /**
   * Resolves and asserts the current user. The global guard rejects
   * unauthenticated requests with 401 before we get here, but the
   * `@CurrentUser()` decorator returns `undefined` so we throw an extra
   * 401 to make the type narrow explicit.
   */
  private requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }

  @Post('match/:matchId')
  async createForMatch(
    @Param('matchId') matchId: string,
    @Body() dto: UpsertMatchPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const ctx = getRequestContext(req);
    return this.predictionsService.upsertMatchPrediction(
      me.id,
      matchId,
      dto,
      ctx,
    );
  }

  @Put('match/:matchId')
  async updateForMatch(
    @Param('matchId') matchId: string,
    @Body() dto: UpsertMatchPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const ctx = getRequestContext(req);
    return this.predictionsService.upsertMatchPrediction(
      me.id,
      matchId,
      dto,
      ctx,
    );
  }

  @Get('me')
  async listMine(
    @Query() query: ListMyPredictionsDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const me = this.requireUser(user);
    return this.predictionsService.listUserPredictions(me.id, {
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
    return this.predictionsService.findUserPrediction(me.id, matchId);
  }

  // ── Special predictions ────────────────────────────────────────────

  @Post('special')
  async createSpecial(
    @Body() dto: UpsertSpecialPredictionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const ctx = getRequestContext(req);
    return this.specialPredictionsService.upsertSpecialPrediction(
      me.id,
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
    const ctx = getRequestContext(req);
    return this.specialPredictionsService.upsertSpecialPrediction(
      me.id,
      dto,
      ctx,
    );
  }

  @Get('special/me')
  async getMySpecial(@CurrentUser() user: AuthenticatedUser | undefined) {
    const me = this.requireUser(user);
    return this.specialPredictionsService.findForUser(me.id);
  }
}
