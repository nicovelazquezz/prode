import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { loadEnv } from '../../config/env.js';

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Guard for `POST /payments/init` (and any other public mutation). Reads
 * the token from header `X-Turnstile-Token` (preferred) or body field
 * `turnstileToken`, and verifies it against Cloudflare's siteverify
 * endpoint. Anything other than `success: true` rejects with 401.
 *
 * Bypass:
 *   - `NODE_ENV === 'test'` always passes — integration tests exercise
 *     the controller without Cloudflare in the loop.
 *   - When `TURNSTILE_SECRET_KEY` is unset (dev / staging without keys
 *     yet), the guard logs a warning and lets the request through. In
 *     production the env validator enforces presence (see env.ts when
 *     we tighten the schema for prod deploys).
 */
@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly logger = new Logger(TurnstileGuard.name);
  private readonly secret: string | undefined;
  private readonly nodeEnv: string;

  constructor() {
    const env = loadEnv();
    this.secret = env.TURNSTILE_SECRET_KEY;
    this.nodeEnv = env.NODE_ENV;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.nodeEnv === 'test') return true;
    if (!this.secret) {
      this.logger.warn(
        'TURNSTILE_SECRET_KEY not set — bypassing Turnstile verification',
      );
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const headerToken = req.headers['x-turnstile-token'];
    const headerStr = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    const bodyToken = (req.body as { turnstileToken?: string } | undefined)
      ?.turnstileToken;
    const token = headerStr ?? bodyToken;

    if (!token) {
      throw new UnauthorizedException('Missing Turnstile token');
    }

    const remoteIp = req.ip ?? req.socket?.remoteAddress;
    const params = new URLSearchParams();
    params.set('secret', this.secret);
    params.set('response', token);
    if (remoteIp) params.set('remoteip', remoteIp);

    let res: Response;
    try {
      res = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body: params,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
    } catch (err) {
      // Network failure to Cloudflare — fail closed: a public, expensive
      // endpoint must not be allowed through if we can't verify.
      this.logger.error(
        `Turnstile verify network error: ${(err as Error).message}`,
      );
      throw new UnauthorizedException('Turnstile verification failed');
    }

    if (!res.ok) {
      this.logger.warn(`Turnstile verify HTTP ${res.status}`);
      throw new UnauthorizedException('Turnstile verification failed');
    }

    const data = (await res.json()) as TurnstileResponse;
    if (!data.success) {
      this.logger.warn(
        `Turnstile rejected token: ${(data['error-codes'] ?? []).join(',')}`,
      );
      throw new UnauthorizedException('Invalid Turnstile token');
    }
    return true;
  }
}
