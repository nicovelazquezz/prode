import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { UsersService } from './users.service.js';
import { UpdateMeDto } from './dto/update-me.dto.js';

const PROFILE_TTL_MS = 60 * 1000;

/**
 * Per-entry breakdown surfaced on the public profile for users with
 * multiple prodes. Aggregates predictions for FINISHED matches by entry.
 */
export interface PublicProfileEntry {
  id: string;
  position: number;
  alias: string | null;
  totalPoints: number;
  predictionsFinished: Array<{
    matchId: string;
    scoreHome: number;
    scoreAway: number;
    outcomeType: string | null;
    pointsEarned: number;
    match: {
      id: string;
      matchNumber: number;
      phase: string;
      kickoffAt: Date;
      scoreHome: number | null;
      scoreAway: number | null;
      homeTeam: { fifaCode: string; name: string } | null;
      awayTeam: { fifaCode: string; name: string } | null;
    };
  }>;
}

export interface PublicProfile {
  id: string;
  firstName: string;
  lastName: string;
  /** Aggregate of every entry's pointsEarned. */
  totalPoints: number;
  /** One element per ACTIVE entry of the user. */
  entries: PublicProfileEntry[];
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly users: UsersService,
  ) {}

  /**
   * PATCH /users/me — el user edita campos editables de su perfil
   * (firstName, lastName, whatsapp, whatsappOptIn). Devuelve el User
   * actualizado sin password ni campos sensibles. Audit log automático.
   *
   * Validación: class-validator vía UpdateMeDto (regex names + whatsapp
   * E.164). Si alguno falla, ValidationPipe global devuelve 400 con
   * mensajes específicos.
   *
   * No-op friendly: si el body es `{}` o todos los valores son iguales
   * al estado actual, devuelve el user sin tocar la BD ni escribir audit.
   */
  @Patch('me')
  async updateMe(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: UpdateMeDto,
    @Req() req: Request,
  ): Promise<{
    id: string;
    dni: string;
    firstName: string;
    lastName: string;
    whatsapp: string;
    whatsappOptIn: boolean;
    role: string;
    status: string;
    createdAt: Date;
    lastLoginAt: Date | null;
  }> {
    const updated = await this.users.updateMe(current.id, body, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // Mismo shape que /auth/me — no exponemos passwordHash ni
    // tokens. Reusamos los campos públicos del modelo Prisma.
    return {
      id: updated.id,
      dni: updated.dni,
      firstName: updated.firstName,
      lastName: updated.lastName,
      whatsapp: updated.whatsapp,
      whatsappOptIn: updated.whatsappOptIn,
      role: updated.role,
      status: updated.status,
      createdAt: updated.createdAt,
      lastLoginAt: updated.lastLoginAt,
    };
  }

  /**
   * Public read-only profile used by the leaderboard drawer when an
   * anonymous visitor (or any signed-in user) taps a row. Returns:
   *   - id / firstName / lastName (no DNI, whatsapp, role, status, ...)
   *   - one breakdown per ACTIVE entry of the user, with the entry's
   *     FINISHED-match predictions and per-entry total points.
   *
   * Edge cases:
   *   - User doesn't exist → 404.
   *   - User exists but status is BANNED → 404 (don't acknowledge them).
   *   - Users with no entry yet (admin / pre-payment): empty entries[].
   *
   * Cached 60s in the in-memory cache-manager store.
   */
  @Public()
  @Get(':id/public-profile')
  async publicProfile(@Param('id') id: string): Promise<PublicProfile> {
    const cacheKey = `users:public-profile:${id}:v2`;
    const cached = await this.cache.get<PublicProfile>(cacheKey);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
    if (!user || user.status === 'BANNED') {
      throw new NotFoundException();
    }

    const entries = await this.prisma.entry.findMany({
      where: { userId: id, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        position: true,
        alias: true,
        predictions: {
          where: { match: { status: 'FINISHED' } },
          orderBy: { match: { kickoffAt: 'asc' } },
          select: {
            matchId: true,
            scoreHome: true,
            scoreAway: true,
            outcomeType: true,
            pointsEarned: true,
            match: {
              select: {
                id: true,
                matchNumber: true,
                phase: true,
                kickoffAt: true,
                scoreHome: true,
                scoreAway: true,
                homeTeam: { select: { fifaCode: true, name: true } },
                awayTeam: { select: { fifaCode: true, name: true } },
              },
            },
          },
        },
      },
    });

    const entryBreakdown: PublicProfileEntry[] = entries.map((e) => ({
      id: e.id,
      position: e.position,
      alias: e.alias,
      totalPoints: e.predictions.reduce((sum, p) => sum + p.pointsEarned, 0),
      predictionsFinished: e.predictions,
    }));

    const totalPoints = entryBreakdown.reduce(
      (sum, e) => sum + e.totalPoints,
      0,
    );

    const result: PublicProfile = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      totalPoints,
      entries: entryBreakdown,
    };

    await this.cache.set(cacheKey, result, PROFILE_TTL_MS);
    return result;
  }
}
