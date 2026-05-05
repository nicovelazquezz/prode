import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { EntriesService } from './entries.service.js';
import { InitEntryPaymentDto } from './dto/init-entry-payment.dto.js';
import { UpdateEntryDto } from './dto/update-entry.dto.js';

function getRequestContext(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const uaHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return { ipAddress: req.ip ?? req.socket?.remoteAddress, userAgent };
}

/**
 * Multi-prode endpoints. All routes require authentication (the global
 * JwtAuthGuard handles 401). The init-payment route is rate-limited
 * to 20/hour per user — looser than the public flow's 5/h-per-IP since
 * a logged-in spammer is harder to come by.
 */
@Controller('entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  private requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }

  /**
   * Starts the "agregar otro prode" flow. Validates the cap under
   * SELECT FOR UPDATE inside a TX, creates a PENDING Payment with the
   * caller's userId + chosen alias, and returns the MP initPoint.
   */
  @Throttle({
    'entry-init-payment': {
      limit: 20,
      ttl: 60 * 60 * 1000,
      getTracker: (req) =>
        // Rate-limit per user when logged in; fall back to IP otherwise
        // (the JwtAuthGuard will reject anonymous calls anyway, this
        // is only a defence-in-depth guardrail).
        ((req as { user?: { id?: string } }).user?.id as string | undefined) ??
        req.ip ??
        'unknown',
    },
  })
  @Post('init-payment')
  @HttpCode(HttpStatus.OK)
  async initPayment(
    @Body() dto: InitEntryPaymentDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const ctx = getRequestContext(req);
    return this.entries.initPayment(me.id, dto.alias, ctx);
  }

  /**
   * Lists every ACTIVE entry of the caller with stats. Frontend uses
   * this to populate the EntrySwitcher.
   */
  @Get('me')
  async myEntries(@CurrentUser() user: AuthenticatedUser | undefined) {
    const me = this.requireUser(user);
    return this.entries.listForUser(me.id);
  }

  /** Single entry detail. 403 if not owned. */
  @Get(':id')
  async detail(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const me = this.requireUser(user);
    return this.entries.findOne(me.id, id);
  }

  /**
   * Renames the entry. Allowed until the SpecialPrediction is locked
   * (kickoff inaugural). 403 if not owned, 400 SPECIAL_PREDICTION_LOCKED
   * after lock.
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEntryDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ) {
    const me = this.requireUser(user);
    const ctx = getRequestContext(req);
    return this.entries.updateAlias(me.id, id, dto.alias ?? null, ctx);
  }
}
