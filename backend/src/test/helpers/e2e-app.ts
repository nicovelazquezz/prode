import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Redis } from 'ioredis';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { CHECKOUT_PROVIDER } from '../../shared/checkout/checkout.provider.js';
import { MockCheckoutProvider } from '../../shared/checkout/mock.provider.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.service.js';

/**
 * Handles returned by {@link createE2EApp}. The handles are returned grouped
 * because every E2E flow needs all of them at once (Prisma to seed/verify,
 * mockProvider to simulate webhooks, Redis to drop cached entries) and
 * destructuring at the call site reads cleaner than passing the whole bag
 * around.
 */
export interface E2EAppHandles {
  app: INestApplication;
  prisma: PrismaService;
  mockProvider: MockCheckoutProvider;
  redis: Redis;
  /**
   * Truncates user-domain tables so the next test starts from a clean slate
   * **without** wiping the seed data (matches, teams, scoring_rules, etc.)
   * that the boot relies on. Preserves the admin user (`role = 'ADMIN'`) so
   * `auth/login` keeps working across test cases.
   */
  cleanDb: () => Promise<void>;
  closeApp: () => Promise<void>;
}

/**
 * Boots a full Nest app against the local Postgres + Redis (the docker-compose
 * stack the project uses for development). NODE_ENV is forced to `test` so the
 * CheckoutModule binds {@link MockCheckoutProvider} instead of the real
 * MercadoPago one, mirroring how the existing payment-flow specs configure
 * themselves.
 *
 * Pragmatic choice over Testcontainers: spinning up a fresh Postgres per
 * suite costs ~5-10 s per spec on this hardware and is harder to reason
 * about (migrations, seed) than reusing the dev DB with surgical cleanup.
 * The seed data (matches, teams, scoring config) is preserved by
 * {@link E2EAppHandles.cleanDb}; user-domain rows are wiped between tests.
 *
 * Tests can pass an `overrider` callback to swap providers (e.g. mocking
 * `PhaseService.maybeClosePhase` so finishing one match doesn't trigger
 * GROUPS phase closure when only some matches are seeded as FINISHED).
 */
export async function createE2EApp(
  overrider?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<E2EAppHandles> {
  process.env.NODE_ENV = 'test';

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrider) builder = overrider(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();

  const prisma = app.get(PrismaService);
  const mockProvider = app.get(CHECKOUT_PROVIDER) as MockCheckoutProvider;
  const redis = app.get<Redis>(REDIS_CLIENT);

  const cleanDb = async (): Promise<void> => {
    // Order matters: child rows referencing users / payments / matches must
    // go before their parents. We TRUNCATE … RESTART IDENTITY CASCADE in
    // one shot because the dependency graph is small and Postgres handles
    // the FK ordering for us.
    //
    // We deliberately do NOT touch:
    //   - users WHERE role='ADMIN' (the seeded admin used by /auth/login)
    //   - matches / teams / players / scoring_rules / phase_multipliers
    //     / special_prize_rules / app_config (immutable seed bedrock)
    //
    // Match scores / status are reset by individual tests (snapshot/restore)
    // rather than here so the helper stays general.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        audit_logs,
        notifications,
        league_memberships,
        leagues,
        phase_winners,
        special_predictions,
        predictions,
        password_resets,
        refresh_tokens,
        payments
      RESTART IDENTITY CASCADE
    `);
    // Non-admin users last so anything FK'd to them is already gone.
    await prisma.user.deleteMany({
      where: { role: { not: 'ADMIN' } },
    });

    // Drop any cached payloads (leaderboard, upcoming) so the test starts
    // from cold cache. Keep BullMQ's keys (`bull:*`) so background workers
    // attached during boot don't lose their state mid-suite.
    const stale = await redis.keys('leaderboard:*');
    if (stale.length) await redis.del(...stale);
    const upcoming = await redis.keys('matches:upcoming:*');
    if (upcoming.length) await redis.del(...upcoming);
    const matchCounts = await redis.keys('predictions:match-count:*');
    if (matchCounts.length) await redis.del(...matchCounts);

    // Reset the in-memory mock so previous preferences/payments don't leak
    // into the next case (the counter would still increment, harmless, but
    // cleaner state simplifies debugging when tests fail).
    mockProvider.reset();
  };

  const closeApp = async (): Promise<void> => {
    await app.close();
  };

  return { app, prisma, mockProvider, redis, cleanDb, closeApp };
}

/**
 * Stable login credentials for the seeded admin. Mirrors the values
 * `prisma/seed-config.ts` writes; falls back to env override so a test
 * running against a different bootstrap (e.g. CI seed with a custom
 * password) still works.
 */
export const ADMIN_LOGIN = {
  dni: process.env.ADMIN_DEFAULT_DNI ?? '00000000',
  password: process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!',
};

/**
 * Generates a unique 8-digit DNI for the test run. Stays out of the seed's
 * admin range (`00000000`) and out of the 1xxxxxxx / 5xxxxxxx ranges other
 * E2E suites already burn (see `complete-registration.spec.ts`,
 * `predictions-e2e.spec.ts`).
 */
export function uniqueDni(): string {
  const n = (Date.now() + Math.floor(Math.random() * 1000)) % 80_000_000;
  return String(20_000_000 + n).slice(-8);
}

/**
 * Generates a unique 13-digit Argentine WhatsApp number for the test run.
 * Same reasoning as {@link uniqueDni} for ranges.
 */
export function uniqueWhatsapp(): string {
  const n = (Date.now() + Math.floor(Math.random() * 1000)) % 1_000_000_000;
  return `549${String(2_000_000_000 + n).slice(-9)}`.slice(0, 13);
}
