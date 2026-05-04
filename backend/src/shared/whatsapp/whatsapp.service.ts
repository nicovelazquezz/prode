import { Injectable, Logger } from '@nestjs/common';
import { type Env, loadEnv } from '../../config/env.js';

/**
 * Minimal wrapper around the existing WhatsApp HTTP backend.
 *
 * Contract:
 *   POST {WHATSAPP_API_URL}/send
 *     Authorization: Bearer {WHATSAPP_API_TOKEN}
 *     Content-Type: application/json
 *     body: { to, message }
 *
 * Any non-2xx response throws so the BullMQ worker can flip the
 * Notification row to FAILED and trigger BullMQ's retry/backoff.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  async send(to: string, message: string): Promise<void> {
    const url = `${this.env.WHATSAPP_API_URL.replace(/\/+$/, '')}/send`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, message }),
      });
    } catch (err) {
      // Network-level failure — surface it so BullMQ retries.
      this.logger.warn(
        `WhatsApp request failed (network): ${(err as Error).message}`,
      );
      throw err;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      const msg = `WhatsApp send failed: ${response.status} ${response.statusText} — ${body}`;
      this.logger.warn(msg);
      throw new Error(msg);
    }
  }
}
