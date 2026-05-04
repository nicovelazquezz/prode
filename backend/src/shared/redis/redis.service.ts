import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Thin wrapper around the shared `ioredis` client. We expose the underlying
 * client via injection (`REDIS_CLIENT`) so feature modules can either use the
 * client directly (cache, locks) or go through this service for ergonomic
 * helpers. Phase 4 only needs the plain client for BullMQ; this service is
 * here so later phases (cache, throttler) plug in without re-wiring DI.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (err) {
      this.logger.warn(`Redis ping failed: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy() {
    // BullMQ owns its own connection; we close only the client we created.
    if (this.client.status !== 'end') {
      await this.client.quit().catch(() => undefined);
    }
  }
}

export function createRedisClient(url: string): Redis {
  // BullMQ requires `maxRetriesPerRequest: null` on its connection;
  // for the general-purpose client it is fine to keep ioredis defaults
  // (the BullMQ module owns its own dedicated connection).
  return new Redis(url, { lazyConnect: false });
}
