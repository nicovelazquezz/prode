import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { loadEnv } from '../../config/env.js';

/**
 * Centralised BullMQ root configuration.
 *
 * Why a custom module instead of `BullModule.forRoot` directly in AppModule:
 *   1) keeps DI wiring localised — feature modules import this module
 *      indirectly via the queue registration (`BullModule.registerQueue`).
 *   2) makes it trivial to swap the connection (for tests, a different
 *      Redis URL, etc.) by changing `loadEnv()`.
 *
 * Connection options:
 *   `maxRetriesPerRequest: null` is **required** by BullMQ's worker so it can
 *   keep blocking commands open — without it, BullMQ logs a warning and may
 *   misbehave under reconnects. We pass it explicitly here.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          connection: {
            // ioredis accepts a URL via the connection.url style; @nestjs/bullmq
            // forwards this object to a fresh ioredis client owned by BullMQ.
            url: env.REDIS_URL,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class BullMqModule {}
