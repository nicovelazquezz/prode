import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PredictionsService } from './predictions.service.js';
import { SpecialPredictionsService } from './special-predictions.service.js';
import { PredictionsController } from './predictions.controller.js';

/**
 * Wires the prediction services + controllers. Audit is provided by the
 * global `AuditModule`, so we don't need to import it explicitly. The
 * public count endpoint lands in Task 7.5; this module already owns both
 * the per-match and the special-prediction services.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PredictionsController],
  providers: [PredictionsService, SpecialPredictionsService],
  exports: [PredictionsService, SpecialPredictionsService],
})
export class PredictionsModule {}
