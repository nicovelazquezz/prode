import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

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
  ) {}

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
