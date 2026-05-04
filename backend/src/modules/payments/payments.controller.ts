import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PaymentsService } from './payments.service.js';
import { InitPaymentDto } from './dto/init-payment.dto.js';
import {
  CHECKOUT_PROVIDER,
  type CheckoutProvider,
} from '../../shared/checkout/checkout.provider.js';

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
  ) {}

  @Public()
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
   *   1) Verify HMAC signature first — invalid headers throw 401 before
   *      we touch the DB or burn an MP API call.
   *   2) Hand off to PaymentsService for atomic update + side effects.
   *
   * `@Public()` because MP doesn't authenticate; HMAC is the gate.
   * The body is parsed normally — the signature scheme covers `data.id`
   * + `request-id` + ts, NOT the full body, so we don't need rawBody here.
   */
  @Public()
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
    return this.paymentsService.processWebhook(body);
  }
}
