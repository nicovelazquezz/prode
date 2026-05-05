import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

/**
 * Public stats endpoints (currently just the landing-page counter).
 * Uses the default in-memory cache-manager store — same approach as
 * MatchesModule, which keeps Redis out of the integration fixtures
 * for endpoints whose payload is tiny and refresh window is short.
 */
@Module({
  imports: [PrismaModule, CacheModule.register()],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
