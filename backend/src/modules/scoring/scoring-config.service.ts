import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import type {
  OutcomeType,
  Phase,
} from '../../../generated/prisma/enums.js';

/**
 * Cache TTL for scoring configuration. The defaults change rarely (a
 * mid-tournament tweak is the main use case) so a 1h window is a good
 * balance between freshness and avoiding a DB round-trip on every
 * `finishMatchAndScore` call.
 */
const CONFIG_TTL_MS = 60 * 60 * 1000;

const SCORING_RULES_KEY = 'scoring:rules:v1';
const PHASE_MULTIPLIERS_KEY = 'scoring:multipliers:v1';

export type ScoringRulesMap = Record<OutcomeType, number>;
export type PhaseMultipliersMap = Record<Phase, number>;

/**
 * Read-through cache over `ScoringRule` and `PhaseMultiplier`. Both
 * tables are small (≤7 rows), single-row-per-key, and read on every
 * scoring call — the cache is what keeps `finishMatchAndScore` from
 * hitting the DB twice per match. Writes (admin endpoints in a future
 * phase) MUST call `invalidate()` to evict so the next read sees fresh
 * values.
 *
 * Cache backend: `@nestjs/cache-manager`'s in-memory store. Spec
 * section 7.1 calls out Redis as the eventual production store; this
 * service is implementation-agnostic so swapping later is a one-line
 * change in the module imports.
 */
@Injectable()
export class ScoringConfigService {
  private readonly logger = new Logger(ScoringConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Returns `{ EXACT: 5, WINNER_AND_DIFF: 3, ... }`. Missing rows fall
   * through with `0` so a half-seeded DB never crashes scoring; in that
   * scenario the audit trail (and admin alerts on errors) surface the
   * misconfig.
   */
  async getRules(): Promise<ScoringRulesMap> {
    const cached = await this.cache.get<ScoringRulesMap>(SCORING_RULES_KEY);
    if (cached) return cached;

    const rows = await this.prisma.scoringRule.findMany();
    const map = {
      EXACT: 0,
      WINNER_AND_DIFF: 0,
      DRAW_DIFFERENT: 0,
      WINNER_ONLY: 0,
      MISS: 0,
    } as ScoringRulesMap;
    for (const row of rows) {
      map[row.outcomeType] = row.basePoints;
    }
    await this.cache.set(SCORING_RULES_KEY, map, CONFIG_TTL_MS);
    return map;
  }

  /**
   * Returns `{ GROUPS: 1.0, ROUND_32: 1.5, ... }`. The DB stores Decimal(3,1)
   * which Prisma surfaces as a `Decimal` runtime instance — we normalise
   * to plain `number` here because downstream maths is JS-floating point
   * anyway (and the maximum multiplier is 5.0, well within float53 range).
   */
  async getMultipliers(): Promise<PhaseMultipliersMap> {
    const cached = await this.cache.get<PhaseMultipliersMap>(PHASE_MULTIPLIERS_KEY);
    if (cached) return cached;

    const rows = await this.prisma.phaseMultiplier.findMany();
    const map = {
      GROUPS: 1,
      ROUND_32: 1,
      ROUND_16: 1,
      QUARTERS: 1,
      SEMIS: 1,
      THIRD_PLACE: 1,
      FINAL: 1,
    } as PhaseMultipliersMap;
    for (const row of rows) {
      // Prisma Decimal exposes `.toNumber()`; toString fallback covers
      // mocked plain-object values the integration tests sometimes pass.
      const raw = row.multiplier as unknown as { toNumber?: () => number };
      const asNumber =
        typeof raw.toNumber === 'function'
          ? raw.toNumber()
          : Number(row.multiplier);
      map[row.phase] = asNumber;
    }
    await this.cache.set(PHASE_MULTIPLIERS_KEY, map, CONFIG_TTL_MS);
    return map;
  }

  /**
   * Drops both cached entries. Call from admin write-paths (Phase 6+
   * admin config endpoints) so the next scoring call sees fresh values.
   * Idempotent — safe to call when nothing is cached.
   */
  async invalidate(): Promise<void> {
    await this.cache.del(SCORING_RULES_KEY);
    await this.cache.del(PHASE_MULTIPLIERS_KEY);
    this.logger.log('Scoring config cache invalidated');
  }
}
