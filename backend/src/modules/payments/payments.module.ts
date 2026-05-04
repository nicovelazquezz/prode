import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

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
  imports: [
    PrismaModule,
    // Re-register the notifications queue here so PaymentsService can
    // inject it and add the delayed admin-orphan-alert job. BullMQ's
    // root config (`BullMqModule`) is global so the connection is
    // already wired up; `registerQueue` only opens a producer handle.
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
