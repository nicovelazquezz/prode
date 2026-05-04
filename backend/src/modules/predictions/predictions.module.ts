import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PredictionsService } from './predictions.service.js';
import { PredictionsController } from './predictions.controller.js';

/**
 * Wires the prediction services + controllers. Audit is provided by the
 * global `AuditModule`, so we don't need to import it explicitly. The
 * SpecialPredictionsService and the public count endpoint land in later
 * tasks (7.3 and 7.5) to keep each commit's diff focused.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PredictionsController],
  providers: [PredictionsService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
