import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../config/env.js';
import { REDIS_CLIENT, RedisService, createRedisClient } from './redis.service.js';

/**
 * Provides a shared `ioredis` client (`REDIS_CLIENT`) and the `RedisService`
 * convenience wrapper. Global so any module can `@Inject(REDIS_CLIENT)` or
 * inject `RedisService` without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const env = loadEnv();
        return createRedisClient(env.REDIS_URL);
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
