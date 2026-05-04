import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PredictionsService } from './predictions.service.js';

/**
 * Wires the prediction services. Audit is provided by the global
 * `AuditModule`, so we don't need to import it explicitly. Controllers
 * (Tasks 7.2 / 7.3 / 7.5) are added in subsequent commits to keep each
 * task's diff focused.
 */
@Module({
  imports: [PrismaModule],
  providers: [PredictionsService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
