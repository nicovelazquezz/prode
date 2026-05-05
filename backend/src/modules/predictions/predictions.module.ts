import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PredictionsService } from './predictions.service.js';
import { SpecialPredictionsService } from './special-predictions.service.js';
import { PredictionsController } from './predictions.controller.js';
import { EntriesPredictionsController } from './entries-predictions.controller.js';
import { MatchPredictionsPublicController } from './match-predictions-public.controller.js';

/**
 * Wires the prediction services + controllers. Audit is provided by the
 * global `AuditModule`, so we don't need to import it explicitly.
 *
 * Multi-prode: two parallel controller surfaces.
 *   - PredictionsController (legacy /predictions/...) — resolves the
 *     caller's primary entry; kept until the FE rebinds.
 *   - EntriesPredictionsController (/entries/:entryId/...) — explicit
 *     entryId in the URL, ownership-checked.
 */
@Module({
  imports: [PrismaModule, CacheModule.register()],
  controllers: [
    PredictionsController,
    EntriesPredictionsController,
    MatchPredictionsPublicController,
  ],
  providers: [PredictionsService, SpecialPredictionsService],
  exports: [PredictionsService, SpecialPredictionsService],
})
export class PredictionsModule {}
