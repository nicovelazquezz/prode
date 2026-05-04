import { Global, Module } from '@nestjs/common';
import { AdminAlertsService } from './admin-alerts.service.js';

/**
 * Global so any feature module (payments, webhooks, exception filters)
 * can inject `AdminAlertsService` without having to re-import. Relies on
 * the global `NotificationsModule` for the actual delivery pipeline.
 */
@Global()
@Module({
  providers: [AdminAlertsService],
  exports: [AdminAlertsService],
})
export class AdminAlertsModule {}
