import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { ScoringConfigService } from './scoring-config.service.js';

/**
 * Scoring module. Hosts the pure outcome classifier helpers, the cached
 * config service, and (later in Phase 8) the scoring + phase progression
 * services.
 *
 * Cache: dedicated `CacheModule.register()` instance keeps the
 * `ScoringConfigService` cache local to this module. Spec section 7.1
 * marks Redis as the eventual production store; the swap is a one-line
 * change here.
 */
@Module({
  imports: [PrismaModule, CacheModule.register()],
  providers: [ScoringConfigService],
  exports: [ScoringConfigService],
})
export class ScoringModule {}
