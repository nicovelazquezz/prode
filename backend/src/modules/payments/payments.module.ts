import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Wires the public payment flow. Depends on:
 *   - PrismaModule (Payment / AppConfig reads & writes)
 *   - AuthModule (global, provides AuthService for token primitives)
 *   - AuditModule (global, AuditService)
 *   - CheckoutModule (global, exposes CHECKOUT_PROVIDER)
 *   - NotificationsModule (global, exposes NotificationsService — needed
 *     in later tasks 5.5+ for webhook side-effects)
 *   - AdminAlertsModule (global, AdminAlertsService — Tasks 5.5/5.7/5.10)
 */
@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
