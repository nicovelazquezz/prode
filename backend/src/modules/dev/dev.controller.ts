import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import type {
  ProviderPayment,
  ProviderPaymentStatus,
} from '../../shared/checkout/checkout.types.js';
import { loadEnv } from '../../config/env.js';
import { SimulateWebhookDto } from './dto/simulate-webhook.dto.js';

/**
 * Maps the lower-case MP-style status the frontend sends to our domain
 * enum. Kept as a tight switch so unknown values fail loud at compile
 * time when the DTO grows new variants.
 */
function toProviderStatus(
  status: SimulateWebhookDto['status'],
): ProviderPaymentStatus {
  switch (status) {
    case 'approved':
      return 'APPROVED';
    case 'rejected':
      return 'REJECTED';
    case 'pending':
      return 'PENDING';
  }
}

/**
 * Dev-only endpoints registered conditionally by `AppModule` when
 * `NODE_ENV !== 'production'`. Belt-and-suspenders: each handler also
 * checks the env at runtime so an accidental conditional-import slip
 * cannot expose this surface in prod (returns 404, never 200).
 *
 * The single endpoint here drives the public payment flow end-to-end
 * without hitting MercadoPago — the frontend's `mock-checkout` page
 * calls it after `POST /payments/init` to simulate the webhook firing.
 *
 * Design choice: rather than reach into `MockCheckoutProvider` (which
 * only binds in `NODE_ENV='test'`), we re-issue the completion token
 * and call `PaymentsService.applyProviderPayment` directly. This keeps
 * the dev path independent of which checkout provider is active and
 * works in `development` (where `MercadoPagoCheckoutProvider` is bound
 * with possibly-empty MP creds).
 */
@Controller('dev')
export class DevController {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Simulates the MP webhook for a given local Payment.
   *
   * Flow:
   *   1) Lookup local Payment by id; 404 if unknown.
   *   2) Re-issue the completion token (mint a fresh plain, replace the
   *      stored hash). The token from `init` is unrecoverable since we
   *      only persist the hash; this swap keeps the magic-link flow
   *      drivable end-to-end in dev without changing the prod contract.
   *   3) Build a fake `ProviderPayment` with `metadata.paymentId` set so
   *      `applyProviderPayment` finds the local row by its fallback
   *      lookup path (works regardless of whether `mpPreferenceId` was
   *      ever set by `init`).
   *   4) Dispatch through the real `PaymentsService.applyProviderPayment`
   *      so all webhook side-effects (recovery notification, admin alert,
   *      audit log, orphan-alert job) fire identically to production.
   *
   * Returns the plain completion token in the response — safe because
   * this endpoint never runs in production. The frontend uses it to
   * navigate straight to `/completar-registro?token=...`.
   */
  @Public()
  @Post('simulate-webhook')
  @HttpCode(HttpStatus.OK)
  async simulateWebhook(@Body() dto: SimulateWebhookDto): Promise<{
    ok: true;
    paymentId: string;
    status: SimulateWebhookDto['status'];
    completionToken: string;
  }> {
    if (this.env.NODE_ENV === 'production') {
      // Defense-in-depth: AppModule won't import DevModule in prod, but
      // if anything goes wrong with that gating we still 404 here.
      throw new NotFoundException();
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${dto.paymentId} not found`);
    }

    // Re-issue completion token so /completar-registro can be driven
    // from the dev flow. The original token is irrecoverable (only the
    // sha256 hash is persisted by `init`), so we mint a new one and
    // swap the stored hash.
    const completionToken = this.auth.generatePlainToken();
    const completionTokenHash = this.auth.hashToken(completionToken);
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { completionTokenHash },
    });

    const fakeMpId = `dev_pay_${Date.now()}`;
    const providerPayment: ProviderPayment = {
      id: fakeMpId,
      preferenceId: payment.mpPreferenceId ?? null,
      status: toProviderStatus(dto.status),
      payer: {
        email: dto.payerEmail ?? 'dev@local.test',
        firstName: 'Dev',
      },
      rawData: {
        id: fakeMpId,
        status: dto.status,
        dev: true,
      },
      metadata: {
        completionToken,
        // Used by `applyProviderPayment` as the fallback lookup path —
        // bypasses the need for a real `mpPreferenceId` (which may be
        // unset if `init` didn't run through MP).
        paymentId: payment.id,
      },
    };

    await this.payments.applyProviderPayment(providerPayment);

    return {
      ok: true,
      paymentId: payment.id,
      status: dto.status,
      completionToken,
    };
  }
}
