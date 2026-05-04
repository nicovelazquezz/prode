import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PaymentsService } from './payments.service.js';
import { InitPaymentDto } from './dto/init-payment.dto.js';

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
  constructor(private readonly paymentsService: PaymentsService) {}

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
}
