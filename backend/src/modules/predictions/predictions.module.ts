import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PredictionsService } from './predictions.service.js';
import { SpecialPredictionsService } from './special-predictions.service.js';
import { PredictionsController } from './predictions.controller.js';
import { MatchPredictionsPublicController } from './match-predictions-public.controller.js';

/**
 * Wires the prediction services + controllers. Audit is provided by the
 * global `AuditModule`, so we don't need to import it explicitly.
 *
 * Cache: registers the default in-memory store via `@nestjs/cache-manager`
 * so the public count endpoint and the cache-invalidation logic on writes
 * share the same instance. Spec section 7.1 mentions Redis as the eventual
 * backend; the in-process LRU is fine while the only cached payload is a
 * single integer per match.
 */
@Module({
  imports: [PrismaModule, CacheModule.register()],
  controllers: [PredictionsController, MatchPredictionsPublicController],
  providers: [PredictionsService, SpecialPredictionsService],
  exports: [PredictionsService, SpecialPredictionsService],
})
export class PredictionsModule {}
