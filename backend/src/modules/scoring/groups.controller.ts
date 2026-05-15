import { Controller, Get, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  GroupStandingsService,
  type GroupStanding,
} from './group-standings.service.js';

/**
 * Cache wiring for `GET /groups/standings`. The endpoint aggregates 12
 * group queries (one per group code) plus the per-group team lookup, so
 * we trade the freshness window for an O(1) cache hit. Invalidated from
 * `ScoringService.finishMatchAndScore` / `recalculateMatch` whenever a
 * GROUPS-phase match is persisted, so the 60s TTL is a fallback for the
 * rare miss between admin save and cache.del.
 */
const STANDINGS_CACHE_KEY = 'groups:standings:all';
const STANDINGS_TTL_MS = 60_000;

/**
 * Public read-only standings endpoint. `@Public()` bypasses the global
 * `JwtAuthGuard` — the response is the same for everyone and feeds both
 * the bracket-builder reference panel and any future public groups page.
 */
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly service: GroupStandingsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  @Public()
  @Get('standings')
  async standings(): Promise<Record<string, GroupStanding[]>> {
    const cached = await this.cache.get<Record<string, GroupStanding[]>>(
      STANDINGS_CACHE_KEY,
    );
    if (cached) return cached;
    const fresh = await this.service.getAllGroupStandings();
    await this.cache.set(STANDINGS_CACHE_KEY, fresh, STANDINGS_TTL_MS);
    return fresh;
  }
}
