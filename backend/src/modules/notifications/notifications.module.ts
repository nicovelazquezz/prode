import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsappModule } from '../../shared/whatsapp/whatsapp.module.js';
import { EmailModule } from '../../shared/email/email.module.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsProcessor } from './notifications.processor.js';
import { OrphanAlertProcessor } from '../payments/orphan-alert.processor.js';
import { MatchRemindersCron } from './match-reminders.cron.js';
import { MatchResultProcessor } from './match-result.processor.js';
import { PhaseWinnerProcessor } from './phase-winner.processor.js';
import { NOTIFICATIONS_QUEUE } from './notifications.constants.js';

/**
 * Registers the BullMQ `notifications` queue, the producer
 * `NotificationsService`, and the `NotificationsProcessor` worker.
 *
 * Marked `@Global` so any feature module can inject `NotificationsService`
 * (auth/forgot-password, payments, admin alerts, …) without re-importing.
 * The BullMQ root config (`BullMqModule`) lives in AppModule and is
 * itself global, so the queue's connection is already wired by the
 * time we register here.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    WhatsappModule,
    EmailModule,
  ],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    OrphanAlertProcessor,
    MatchRemindersCron,
    MatchResultProcessor,
    PhaseWinnerProcessor,
  ],
  exports: [
    NotificationsService,
    OrphanAlertProcessor,
    MatchRemindersCron,
    MatchResultProcessor,
    PhaseWinnerProcessor,
  ],
})
export class NotificationsModule {}
