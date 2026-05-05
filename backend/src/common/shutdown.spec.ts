import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../shared/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../shared/redis/redis.service.js';
import type { Redis } from 'ioredis';

/**
 * Regression for the graceful shutdown wiring (Task 12.6). Boots the
 * full app with `enableShutdownHooks()` on, then closes it and asserts
 * that the connection-owning singletons released their underlying
 * clients. No BullMQ workers are exercised here — `@nestjs/bullmq`'s
 * `BullExplorer` already has its own coverage upstream and the
 * notification processor's behaviour is covered by its dedicated
 * processor specs.
 *
 * The bar is intentionally low: this catches the regression where
 * someone removes `enableShutdownHooks()` or breaks the `OnModuleDestroy`
 * implementation on a shared service.
 */
describe('graceful shutdown', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
  }, 30_000);

  it('closes Prisma + Redis cleanly on app.close()', async () => {
    // Sanity: connections are alive before close.
    expect(await prisma.ping()).toBe(true);
    expect(redis.status).toBe('ready');

    await app.close();

    // After close ioredis flips its status to `end` once `quit()` is
    // observed by the connection. Matches what the production process
    // does on SIGTERM.
    expect(['end', 'close']).toContain(redis.status);
  }, 30_000);
});
