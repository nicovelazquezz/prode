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

/**
 * Cache window for `GET /users/:id/public-profile`. The leaderboard's
 * row drilldown is the main consumer; pages of 50 rows × multiple users
 * tapped per session benefit from a short shared cache. 60s mirrors the
 * stats endpoint and avoids stale FINISHED-prediction lists for more
 * than ~1 minute after a match closes.
 */
const PROFILE_TTL_MS = 60 * 1000;

/** Shape returned by the public profile endpoint. Type-only, exported
 * so the frontend can `import type` later without depending on the
 * Prisma generated types. */
export interface PublicProfile {
  id: string;
  firstName: string;
  lastName: string;
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

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Public read-only profile used by the leaderboard drawer when an
   * anonymous visitor (or any signed-in user) taps a row. Returns only:
   *   - id / firstName / lastName (no DNI, whatsapp, role, status, ...)
   *   - the user's predictions for matches that have FINISHED, with
   *     team + score data so the drawer can render compact result rows.
   *
   * Edge cases:
   *   - User doesn't exist → 404.
   *   - User exists but status is BANNED → 404 (don't acknowledge them).
   *   - User exists, role=ADMIN: still returns the row — admins can
   *     have predictions and the leaderboard surface might list them.
   *
   * Cached 60s in the in-memory cache-manager store.
   */
  @Public()
  @Get(':id/public-profile')
  async publicProfile(@Param('id') id: string): Promise<PublicProfile> {
    const cacheKey = `users:public-profile:${id}:v1`;
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
      // 404 on BANNED so we don't even acknowledge the row exists.
      throw new NotFoundException();
    }

    const predictions = await this.prisma.prediction.findMany({
      where: {
        userId: id,
        match: { status: 'FINISHED' },
      },
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
    });

    const result: PublicProfile = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      predictionsFinished: predictions,
    };

    await this.cache.set(cacheKey, result, PROFILE_TTL_MS);
    return result;
  }
}
