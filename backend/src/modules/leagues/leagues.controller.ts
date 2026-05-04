import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { LeaguesService } from './leagues.service.js';
import { CreateLeagueDto } from './dto/create-league.dto.js';
import { JoinLeagueDto } from './dto/join-league.dto.js';

/**
 * Resolves IP + user-agent from the express request for downstream
 * audit-log attribution. Mirrors the helper in `predictions.controller.ts`
 * so the audit shape stays consistent across modules.
 */
function getRequestContext(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const uaHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return { ipAddress: req.ip ?? req.socket?.remoteAddress, userAgent };
}

/**
 * Authenticated mini-league endpoints (spec section 5.2 / Phase 10). The
 * global `JwtAuthGuard` covers every route — none are marked `@Public()`.
 */
@Controller('leagues')
export class LeaguesController {
  constructor(private readonly leagues: LeaguesService) {}

  /** Narrow the optional decorator value to a real user or 401. */
  private requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }

  /**
   * Creates a new mini-league owned by the caller. Returns the full
   * `League` row including `inviteCode` so the owner can immediately
   * share it via WhatsApp/clipboard.
   */
  @Post()
  async create(
    @Body() dto: CreateLeagueDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const ctx = getRequestContext(req);
    return this.leagues.createLeague(me.id, dto, ctx);
  }

  /**
   * Lists every league the caller is a member of — owned or joined. Each
   * entry carries `memberCount` and `isOwner` so the frontend can render
   * the "Mis ligas" tab without follow-up requests.
   */
  @Get('me')
  async listMine(@CurrentUser() user: AuthenticatedUser | undefined) {
    const me = this.requireUser(user);
    return this.leagues.listForUser(me.id);
  }

  /**
   * Joins the caller to a league via its invite code. Surfaces the
   * domain exceptions from the service (404 if the code doesn't match,
   * 409 if the league is full or the user is already a member). The DTO
   * normalises lowercase input to uppercase before validation runs.
   */
  @Post('join')
  async join(
    @Body() dto: JoinLeagueDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const ctx = getRequestContext(req);
    return this.leagues.joinLeague(me.id, dto.inviteCode, ctx);
  }
}
