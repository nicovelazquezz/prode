import { Controller, Get, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { Public } from '../../common/decorators/public.decorator.js';
import { StatsService, type PublicStats } from './stats.service.js';

/**
 * Cache window for `GET /stats/public`. The landing page's live counter
 * polls every 30s; a 60s TTL gives roughly 1 DB hit per minute even
 * under heavy traffic without making the number feel stale.
 */
const STATS_TTL_MS = 60 * 1000;

const CACHE_KEY = 'stats:public:v1';

@Controller('stats')
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Public live counter for the landing page hero. Cached 60s in the
   * default in-memory cache-manager store (mirrors the pattern in
   * MatchesController.upcoming — a Redis backend can swap in later
   * without touching this surface).
   */
  @Public()
  @Get('public')
  async getPublicStats(): Promise<PublicStats> {
    const cached = await this.cache.get<PublicStats>(CACHE_KEY);
    if (cached) return cached;
    const fresh = await this.stats.getPublicStats();
    await this.cache.set(CACHE_KEY, fresh, STATS_TTL_MS);
    return fresh;
  }
}
