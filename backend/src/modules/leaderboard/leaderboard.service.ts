import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../shared/redis/redis.service.js';
import type { Phase } from '../../../generated/prisma/enums.js';
import {
  LeaderboardRepository,
  type LeaderboardRow,
  type LeaderboardRowWithRank,
} from './leaderboard.repository.js';

/**
 * Cache TTL for the public leaderboard reads. 60 s matches spec 7.1 —
 * the ladder is updated by the `leaderboard.refresh` worker within ~1-2s
 * of every score change, but the worker also calls `invalidate()` after
 * the MV refresh, so this TTL is a backstop for the rare case where the
 * worker itself misses (e.g. transient Redis flap).
 */
const LEADERBOARD_TTL_SECONDS = 60;

/**
 * Cache key prefix. Kept as a constant so `invalidate()` can `KEYS`
 * around it without leaking the magic string into the controller layer.
 */
const LEADERBOARD_KEY_PREFIX = 'leaderboard:';

export interface LeaderboardPage {
  rows: LeaderboardRow[];
  total: number;
}

export interface LeaderboardAround {
  rows: LeaderboardRowWithRank[];
}

/**
 * Public-facing leaderboard reads with Redis-backed caching for the
 * frequent listings. The "around me" endpoint is intentionally
 * un-cached: the slice depends on the calling user's id, so caching
 * would either explode the keyspace (one entry per user) or stale
 * neighbours after a score update.
 *
 * Why Redis directly instead of `@nestjs/cache-manager`: we need the
 * `KEYS leaderboard:*` + `DEL` round-trip in `invalidate()` to drop
 * every page/phase/league entry on a single MV refresh. cache-manager
 * doesn't expose a portable `keys`/`reset` method we can rely on across
 * stores. The shared `REDIS_CLIENT` is already wired by `RedisModule`
 * and serves the same connection BullMQ uses, so there's no extra TCP
 * cost.
 */
@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly repo: LeaderboardRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Cache key for the global page. Keeping the helper here makes the
   * `invalidate()` regex unambiguous — the prefix is the same constant.
   */
  private globalKey(page: number, pageSize: number): string {
    return `${LEADERBOARD_KEY_PREFIX}global:${page}:${pageSize}`;
  }

  private phaseKey(phase: Phase, page: number, pageSize: number): string {
    return `${LEADERBOARD_KEY_PREFIX}phase:${phase}:${page}:${pageSize}`;
  }

  private leagueKey(leagueId: string, page: number, pageSize: number): string {
    return `${LEADERBOARD_KEY_PREFIX}league:${leagueId}:${page}:${pageSize}`;
  }

  /**
   * Reads-through Redis: cache hit → JSON.parse and return; miss → run
   * the repo query, persist with TTL, return. Using `EX` (seconds) so a
   * dropped/restored Redis still gets a deterministic expiry without
   * relying on per-key extras.
   */
  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as T;
      } catch (err) {
        // A corrupt cache entry should never wedge a request — log and
        // fall through to the loader, then overwrite the bad value.
        this.logger.warn(
          `Corrupt cache entry for ${key}: ${(err as Error).message}`,
        );
      }
    }
    const fresh = await loader();
    await this.redis.set(key, JSON.stringify(fresh), 'EX', LEADERBOARD_TTL_SECONDS);
    return fresh;
  }

  async getGlobal(page: number, pageSize: number): Promise<LeaderboardPage> {
    return this.cached(this.globalKey(page, pageSize), () =>
      this.repo.getGlobal(page, pageSize),
    );
  }

  async getByPhase(
    phase: Phase,
    page: number,
    pageSize: number,
  ): Promise<LeaderboardPage> {
    return this.cached(this.phaseKey(phase, page, pageSize), () =>
      this.repo.getByPhase(phase, page, pageSize),
    );
  }

  async getByLeague(
    leagueId: string,
    page: number,
    pageSize: number,
  ): Promise<LeaderboardPage> {
    return this.cached(this.leagueKey(leagueId, page, pageSize), () =>
      this.repo.getByLeague(leagueId, page, pageSize),
    );
  }

  /**
   * Per-user "around me" — never cached because the slice is
   * user-specific and stales the moment a neighbour's score changes.
   * The query itself is cheap (single CTE on the MV).
   */
  async getMyAround(userId: string, n = 5): Promise<LeaderboardAround> {
    const rows = await this.repo.getGlobalAroundUser(userId, n);
    return { rows };
  }

  /**
   * Drops every cached `leaderboard:*` key. Called by the
   * `LeaderboardRefreshProcessor` after a `REFRESH MATERIALIZED VIEW`
   * so the next read sees the updated pointsEarned without waiting for
   * the 60 s TTL.
   *
   * Implementation note: `KEYS` is O(N) over the keyspace and
   * discouraged in busy production Redises. For this app's scale
   * (<200 users × maybe 50 cached pages = a few hundred keys) the cost
   * is negligible. If the keyspace grows we can swap to `SCAN` with a
   * cursor — same call site, marginal complexity bump.
   */
  async invalidate(): Promise<void> {
    const keys = await this.redis.keys(`${LEADERBOARD_KEY_PREFIX}*`);
    if (keys.length === 0) return;
    await this.redis.del(...keys);
    this.logger.debug(`Invalidated ${keys.length} leaderboard cache entries`);
  }
}
