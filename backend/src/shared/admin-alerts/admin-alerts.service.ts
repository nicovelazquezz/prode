import { Injectable, Logger } from '@nestjs/common';
import { type Env, loadEnv } from '../../config/env.js';
import { NotificationsService } from '../../modules/notifications/notifications.service.js';

export interface AdminAlertArgs {
  /**
   * Short event identifier (e.g. "PAYMENT_ORPHAN", "DUPLICATE_DNI").
   * Used as the Notification `title` and shows up at the top of the
   * WhatsApp message so the admin can triage at a glance.
   */
  type: string;
  /** Free-form body. Markdown not interpreted on WhatsApp. */
  message: string;
  /**
   * Optional dedup key for events that may fire repeatedly (e.g. a
   * "still no completion" alert that's scheduled multiple times for
   * the same payment). When provided, the underlying NotificationsService
   * coalesces both the DB row and the queue job.
   */
  dedupKey?: string;
}

/**
 * Front-door for admin-facing WhatsApp alerts (payment orphans, duplicate
 * DNIs at registration, refund webhooks, etc.). All it does is build a
 * standard Notification with `channel=WHATSAPP`, `type=ADMIN_BROADCAST`
 * and `toAddress=ADMIN_WHATSAPP_NUMBER`, then hand it off to the regular
 * notifications outbox. This keeps a single delivery / retry / audit
 * surface for everything that goes out by WhatsApp.
 */
@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);
  private readonly env: Env;

  constructor(private readonly notifications: NotificationsService) {
    this.env = loadEnv();
  }

  async notify(args: AdminAlertArgs): Promise<void> {
    const { type, message, dedupKey } = args;
    this.logger.log(`Admin alert: type=${type} dedup=${dedupKey ?? '-'}`);
    await this.notifications.enqueue({
      userId: null,
      toAddress: this.env.ADMIN_WHATSAPP_NUMBER,
      type: 'ADMIN_BROADCAST',
      title: type,
      message,
      channel: 'WHATSAPP',
      dedupKey,
    });
  }
}
