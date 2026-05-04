import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  CHECKOUT_PROVIDER,
  type CheckoutProvider,
} from '../../shared/checkout/checkout.provider.js';

/**
 * Default inscription price (ARS) used when `AppConfig.inscripcion_precio`
 * is missing. Matches the Phase 2 seed.
 */
const DEFAULT_AMOUNT_ARS = 15_000;

export interface InitPaymentResult {
  paymentId: string;
  initPoint: string;
}

export interface InitPaymentContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Service backing the public payment flow (`POST /payments/init`,
 * `POST /payments/webhook`, `GET /payments/by-token/:token`).
 *
 * Holds the orchestration logic that's deliberately kept out of the
 * controller so it's directly unit-testable and re-callable from cron
 * jobs / workers later in this phase.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    @Inject(CHECKOUT_PROVIDER)
    private readonly checkoutProvider: CheckoutProvider,
  ) {}

  /**
   * Reads the inscription price from `AppConfig`; falls back to the
   * spec default if the row is missing or the value can't be parsed.
   * Cached at the call site; AppConfig changes are rare (and the next
   * `init` will pick them up regardless).
   */
  private async resolveAmount(): Promise<number> {
    const row = await this.prisma.appConfig.findUnique({
      where: { key: 'inscripcion_precio' },
    });
    if (!row) return DEFAULT_AMOUNT_ARS;
    const parsed = Number(row.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `inscripcion_precio is not a positive number: ${row.value}; falling back to ${DEFAULT_AMOUNT_ARS}`,
      );
      return DEFAULT_AMOUNT_ARS;
    }
    return parsed;
  }

  /**
   * Creates a PENDING Payment and a checkout preference at the provider.
   *
   * Flow:
   *   1) generate plain completion token + sha256 hash
   *   2) create Payment(userId=null, status=PENDING, completionTokenHash=…,
   *      tokenExpiresAt=null) — TTL is set when APPROVED, not at init
   *   3) call provider.createPreference (passes plain token through metadata)
   *   4) update Payment with preferenceId
   *   5) audit log `payment.init`
   *
   * Returns `{ paymentId, initPoint }`.
   */
  async init(ctx: InitPaymentContext = {}): Promise<InitPaymentResult> {
    const tokenPlain = this.authService.generatePlainToken();
    const tokenHash = this.authService.hashToken(tokenPlain);
    const amount = await this.resolveAmount();

    const payment = await this.prisma.payment.create({
      data: {
        userId: null,
        amount,
        method: 'MERCADOPAGO',
        status: 'PENDING',
        completionTokenHash: tokenHash,
        tokenExpiresAt: null,
      },
    });

    const { preferenceId, initPoint } = await this.checkoutProvider.createPreference({
      paymentId: payment.id,
      amount,
      completionTokenPlain: tokenPlain,
    });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { mpPreferenceId: preferenceId },
    });

    void this.audit.log({
      action: 'payment.init',
      entity: 'payment',
      entityId: payment.id,
      changes: { amount, mpPreferenceId: preferenceId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { paymentId: payment.id, initPoint };
  }
}
