import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { Public } from '../../common/decorators/public.decorator.js';
import { TurnstileGuard } from '../../common/guards/turnstile.guard.js';
import { PaymentsService } from './payments.service.js';
import { InitPaymentDto } from './dto/init-payment.dto.js';
import {
  CHECKOUT_PROVIDER,
  type CheckoutProvider,
} from '../../shared/checkout/checkout.provider.js';
import { REDIS_CLIENT } from '../../shared/redis/redis.service.js';

/**
 * Idempotency cache key prefix para webhooks de MP. Guardamos el
 * `request-id` con TTL = 24h. MP retransmite con backoff exponencial
 * hasta ~24h; pasada esa ventana nunca es un retry legítimo, es replay.
 */
const WEBHOOK_IDEMPOTENCY_KEY_PREFIX = 'mp:webhook:request-id:';
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Public payment endpoints. `JwtAuthGuard` is bypassed via `@Public()`
 * because the user is anonymous at this point of the flow.
 *
 * Note: anti-bot guard (Cloudflare Turnstile) and rate limiting (5/h per
 * IP) are wired in Phase 12; the DTO already carries `turnstileToken`
 * so the contract stays stable.
 */
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(CHECKOUT_PROVIDER)
    private readonly checkoutProvider: CheckoutProvider,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  @Public()
  @UseGuards(TurnstileGuard)
  @Throttle({ 'payments-init': { limit: 5, ttl: 3_600_000 } })
  @Post('init')
  @HttpCode(HttpStatus.CREATED)
  async init(
    @Body() _dto: InitPaymentDto,
    @Req() req: Request,
  ): Promise<{ paymentId: string; initPoint: string }> {
    return this.paymentsService.init({
      ipAddress: req.ip ?? req.socket?.remoteAddress,
      userAgent: ((): string | undefined => {
        const ua = req.headers['user-agent'];
        return Array.isArray(ua) ? ua[0] : ua;
      })(),
    });
  }

  /**
   * Webhook entry point. Order matters here:
   *   1) Verify HMAC signature + replay window — invalid headers o `ts`
   *      fuera de ±5 min tiran 401 antes de tocar BD ni MP.
   *   2) Idempotency por `request-id` en Redis (TTL 24h). Si MP nos
   *      reentrega el mismo evento (timeout en su lado), respondemos
   *      200 sin re-procesar.
   *   3) Hand off a PaymentsService para update + side effects.
   *
   * `@Public()` porque MP no autentica; HMAC es la barrera.
   * El body se parsea normalmente — la firma cubre `data.id` +
   * `request-id` + ts, NO el body completo, así que no hace falta
   * rawBody acá.
   *
   * Sobre la idempotency: hay dos capas. Esta capa (request-id en
   * Redis) atrapa retries de la infraestructura de MP sin pegarle a
   * Postgres. La capa interna en `PaymentsService.processWebhook`
   * sigue siendo idempotente a nivel pago — cinturón + tirantes.
   */
  @Public()
  @SkipThrottle({
    default: true,
    login: true,
    'auth-recovery': true,
    'payments-init': true,
  })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body() body: { type?: string; data?: { id?: string } },
    @Headers('x-signature') signature: string,
    @Headers('x-request-id') requestId: string,
  ): Promise<{ received: true }> {
    this.checkoutProvider.verifyWebhookSignature({
      signatureHeader: signature ?? '',
      requestId: requestId ?? '',
      dataId: String(body?.data?.id ?? ''),
    });

    // Idempotency: SET NX con TTL 24h. Si la key ya existía (NX falla),
    // skip processing — devolvemos 200 igual para que MP no insista.
    if (requestId) {
      const key = `${WEBHOOK_IDEMPOTENCY_KEY_PREFIX}${requestId}`;
      const set = await this.redis.set(
        key,
        '1',
        'EX',
        WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
      if (set === null) {
        // Ya procesado — no-op.
        return { received: true };
      }
    }

    return this.paymentsService.processWebhook(body);
  }

  /**
   * Public read endpoint that resolves a magic-link token to its current
   * payment state. Returns no payer info — only what the form page needs
   * to decide which branch to render.
   *
   *   - 200: pending / approved-but-not-yet-completed token
   *   - 404: token unknown
   *   - 410: token expired or already used
   */
  @Public()
  @Get('by-token/:token')
  async byToken(@Param('token') token: string): Promise<{
    status: string;
    expiresAt: Date | null;
    completed: boolean;
    hasPayer: boolean;
  }> {
    return this.paymentsService.findByToken(token);
  }
}
