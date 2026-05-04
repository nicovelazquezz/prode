import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ScoringConfigService } from './scoring-config.service.js';

/**
 * Integration test for the cached scoring config service. Boots the full
 * Nest app so we get the real Prisma client + the real cache manager.
 *
 * The seed script populates `ScoringRule` and `PhaseMultiplier` rows
 * (see `prisma/seed-config.ts`), so this suite asserts the service
 * surfaces the seeded values correctly. The cache hit path is exercised
 * by mutating the underlying row, calling `getRules` again, and
 * confirming we still get the cached value (proves the cache fronted
 * the DB hit). `invalidate()` then forces a fresh read.
 */
describe('ScoringConfigService (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ScoringConfigService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    service = app.get(ScoringConfigService);
    // Cold-start: clear cache so the first assertion is deterministic.
    await service.invalidate();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  it('reads scoring rules from the DB and surfaces all five outcome types', async () => {
    const rules = await service.getRules();
    // Spec section 5.2 — the seed script writes these exact values.
    expect(rules.EXACT).toBe(5);
    expect(rules.WINNER_AND_DIFF).toBe(3);
    expect(rules.DRAW_DIFFERENT).toBe(2);
    expect(rules.WINNER_ONLY).toBe(1);
    expect(rules.MISS).toBe(0);
  });

  it('reads phase multipliers from the DB as plain numbers', async () => {
    const multipliers = await service.getMultipliers();
    expect(multipliers.GROUPS).toBe(1);
    expect(multipliers.ROUND_32).toBe(1.5);
    expect(multipliers.ROUND_16).toBe(2);
    expect(multipliers.QUARTERS).toBe(3);
    expect(multipliers.SEMIS).toBe(4);
    expect(multipliers.THIRD_PLACE).toBe(4);
    expect(multipliers.FINAL).toBe(5);
  });

  it('caches the rules so a stealth DB mutation is invisible until invalidate()', async () => {
    // Prime the cache.
    const first = await service.getRules();
    expect(first.EXACT).toBe(5);

    // Mutate the underlying row directly. The cache should mask this.
    await prisma.scoringRule.update({
      where: { outcomeType: 'EXACT' },
      data: { basePoints: 99 },
    });

    try {
      const second = await service.getRules();
      expect(second.EXACT).toBe(5); // still cached

      await service.invalidate();
      const third = await service.getRules();
      expect(third.EXACT).toBe(99); // cache miss → DB read picks up the change
    } finally {
      // Restore so subsequent suites against this DB aren't poisoned.
      await prisma.scoringRule.update({
        where: { outcomeType: 'EXACT' },
        data: { basePoints: 5 },
      });
      await service.invalidate();
    }
  });
});
