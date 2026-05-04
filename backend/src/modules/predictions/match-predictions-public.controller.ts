import {
  Controller,
  Get,
  Inject,
  Param,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { Public } from '../../common/decorators/public.decorator.js';
import { PredictionsService } from './predictions.service.js';

/**
 * Cache TTL for the per-match prediction count. The endpoint is purely
 * informational ("X usuarios ya predijeron"), so a 60-second window keeps
 * load off the DB during pre-kickoff spikes without making the badge feel
 * stale. Cache invalidation on POST/PUT lives in the authenticated
 * controller (Task 7.6) so the badge bumps immediately for the writing user.
 */
const COUNT_TTL_MS = 60 * 1000;

/** Cache key helper, exported so the writers in Task 7.6 share one source. */
export function matchPredictionCountCacheKey(matchId: string): string {
  return `match:${matchId}:predictions:count`;
}

/**
 * Public read-only mounted under `/matches/:matchId/predictions/...`. Lives
 * in the predictions module (it owns the data) but its URL prefix borrows
 * the matches namespace so the resource hierarchy stays intuitive.
 */
@Controller('matches/:matchId/predictions')
export class MatchPredictionsPublicController {
  constructor(
    private readonly predictionsService: PredictionsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  @Public()
  @Get('count')
  async count(@Param('matchId') matchId: string): Promise<{ count: number }> {
    const key = matchPredictionCountCacheKey(matchId);
    const cached = await this.cache.get<{ count: number }>(key);
    if (cached) return cached;

    const fresh = { count: await this.predictionsService.countForMatch(matchId) };
    await this.cache.set(key, fresh, COUNT_TTL_MS);
    return fresh;
  }
}
