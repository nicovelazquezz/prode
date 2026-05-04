import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import {
  AdminMatchesController,
  MatchesController,
} from './matches.controller.js';
import { MatchesService } from './matches.service.js';

/**
 * Wires match listing + admin management.
 *
 * Cache: `@nestjs/cache-manager` with the default in-memory store. Spec
 * section 7.1 mentions Redis as the eventual backend, but the only cached
 * endpoint here (`GET /matches/upcoming`, 5-minute TTL) reads a tiny payload
 * a few times per minute at peak, so an in-process LRU stays well within
 * budget and avoids dragging Redis into the test fixtures of every spec.
 */
@Module({
  imports: [PrismaModule, CacheModule.register()],
  controllers: [MatchesController, AdminMatchesController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
