import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { type Env, loadEnv } from '../../config/env.js';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

/**
 * Wrapper around the Resend SDK.
 *
 * Behaviour:
 *   - When `RESEND_API_KEY` is set, calls Resend and throws if the SDK
 *     reports an error so the BullMQ worker can flip the Notification to
 *     FAILED and trigger retry/backoff.
 *   - When the key is **absent** (typical for local dev / CI), logs a
 *     warning and resolves successfully — i.e. simulates a sent email.
 *     This lets the rest of the notifications pipeline be exercised
 *     end-to-end without holding a real Resend account.
 *
 * Construction is deferred (resend is a live HTTP client; we only build
 * it on first send) so that test environments that never call `send`
 * never construct it either.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly env: Env;
  private client: Resend | null = null;

  constructor() {
    this.env = loadEnv();
  }

  private getClient(): Resend | null {
    if (!this.env.RESEND_API_KEY) return null;
    if (!this.client) {
      this.client = new Resend(this.env.RESEND_API_KEY);
    }
    return this.client;
  }

  async send(args: SendEmailArgs): Promise<void> {
    const { to, subject, html, text } = args;

    if (!html && !text) {
      throw new Error('EmailService.send requires at least one of html|text');
    }

    const client = this.getClient();
    if (!client) {
      this.logger.warn(
        `RESEND_API_KEY not set — simulating email send to ${to} (subject="${subject}")`,
      );
      return;
    }

    // Resend requires `html` or `text` to be present; we already validated.
    const payload = {
      from: this.env.EMAIL_FROM,
      to,
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
    } as Parameters<typeof client.emails.send>[0];

    const { error } = await client.emails.send(payload);
    if (error) {
      const msg = `Resend error: ${error.name} (${error.statusCode ?? 'no status'}): ${error.message}`;
      this.logger.warn(msg);
      throw new Error(msg);
    }
  }
}
