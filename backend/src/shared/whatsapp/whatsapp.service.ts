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
 *
 * Dev fallback: si la `WHATSAPP_API_URL` apunta a un placeholder
 * conocido (`example.com`, `example.org`, `localhost`, `127.0.0.1`),
 * el send se simula — log de "would send" y resolve OK. Esto permite
 * exercise el pipeline de notificaciones en local sin un backend
 * WhatsApp real corriendo. Mismo patrón que EmailService cuando falta
 * RESEND_API_KEY.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly env: Env;
  private readonly devSimulate: boolean;

  constructor() {
    this.env = loadEnv();
    this.devSimulate = isPlaceholderUrl(this.env.WHATSAPP_API_URL);
    if (this.devSimulate) {
      this.logger.warn(
        `WhatsappService running in dev-simulate mode (URL: ${this.env.WHATSAPP_API_URL}). Sends are logged but not delivered.`,
      );
    }
  }

  async send(to: string, message: string): Promise<void> {
    if (this.devSimulate) {
      this.logger.log(
        `[dev-simulate] WhatsApp to=${to} message="${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`,
      );
      return;
    }

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

function isPlaceholderUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'example.com' ||
      hostname === 'example.org' ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.example.com')
    );
  } catch {
    return false;
  }
}
