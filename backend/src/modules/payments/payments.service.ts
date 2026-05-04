import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  CHECKOUT_PROVIDER,
  type CheckoutProvider,
} from '../../shared/checkout/checkout.provider.js';
import type { ProviderPayment } from '../../shared/checkout/checkout.types.js';
import { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';
import { loadEnv, type Env } from '../../config/env.js';

/**
 * Default inscription price (ARS) used when `AppConfig.inscripcion_precio`
 * is missing. Matches the Phase 2 seed.
 */
const DEFAULT_AMOUNT_ARS = 15_000;

/**
 * TTL of the magic link / completion token, applied when the Payment
 * transitions to APPROVED. Matches spec section 6.5 (7 days from paidAt).
 */
const COMPLETION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** BullMQ job name for the delayed admin-orphan-alert (Task 5.10). */
export const ADMIN_ORPHAN_ALERT_JOB = 'admin-orphan-alert';
/** Delay applied to the admin-orphan-alert job — 2 hours. */
export const ADMIN_ORPHAN_ALERT_DELAY_MS = 2 * 60 * 60 * 1000;

/**
 * BullMQ rejects ':' inside custom job ids (reserved for Redis key
 * namespacing). Mirror the convention used by NotificationsService —
 * swap colons for underscores so dedup keys read naturally upstream
 * but are still accepted as job ids.
 */
function toJobId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/:/g, '_')}`;
}

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
  private readonly env: Env;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly adminAlerts: AdminAlertsService,
    @Inject(CHECKOUT_PROVIDER)
    private readonly checkoutProvider: CheckoutProvider,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
  ) {
    this.env = loadEnv();
  }

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

  // ── Webhook ──────────────────────────────────────────────────────────

  /**
   * Processes a verified MP webhook (the controller has already called
   * `checkoutProvider.verifyWebhookSignature` before invoking us). The
   * heavy lifting is split into:
   *
   *   1) **Atomic transition** — `updateMany where status='PENDING'` so
   *      a concurrent webhook can't double-transition. `result.count`
   *      tells us whether *we* were the writer; downstream side-effects
   *      only run when we are.
   *
   *   2) **Inline DB side-effects** (still inside the TX): notification
   *      upsert with `dedupKey: recovery:${paymentId}`; admin alert if
   *      MP didn't send a payer email; refund timestamp on REFUNDED.
   *
   *   3) **Post-commit side-effects**: BullMQ delayed `admin-orphan-alert`
   *      job (uses jobId for dedup so resubmits are no-ops); chargeback
   *      alert on REFUNDED.
   *
   * Returns `{ received: true }` regardless of outcome — MP is happy as
   * long as we return 2xx and we don't want to surface internal state.
   */
  async processWebhook(body: {
    type?: string;
    data?: { id?: string };
  }): Promise<{ received: true }> {
    if (body?.type !== 'payment') return { received: true };
    const dataId = body?.data?.id;
    if (!dataId) return { received: true };

    const mpPayment = await this.checkoutProvider.getPayment(String(dataId));
    const newStatus = mpPayment.status;

    let didTransition = false;
    let transitionedPaymentId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      // Resolve our local Payment. Prefer preferenceId (set at init) and
      // fall back to metadata.paymentId for the corner case where MP
      // doesn't echo the preference id back yet.
      let local: Awaited<ReturnType<typeof tx.payment.findFirst>> = null;
      if (mpPayment.preferenceId) {
        local = await tx.payment.findFirst({
          where: { mpPreferenceId: mpPayment.preferenceId },
        });
      }
      if (!local && mpPayment.metadata.paymentId) {
        local = await tx.payment.findUnique({
          where: { id: mpPayment.metadata.paymentId },
        });
      }
      if (!local) {
        this.logger.error(
          `Webhook: payment not found locally (mp data.id=${dataId}, preferenceId=${mpPayment.preferenceId ?? '-'})`,
        );
        return;
      }

      const now = new Date();
      // Idempotent update: only PENDING rows can transition. A duplicate
      // webhook hits 0 rows here and falls through as a no-op.
      const result = await tx.payment.updateMany({
        where: { id: local.id, status: { in: ['PENDING'] } },
        data: {
          status: newStatus,
          mpPaymentId: String(mpPayment.id),
          mpRawData: mpPayment.rawData as unknown as
            | Parameters<typeof tx.payment.update>[0]['data']['mpRawData']
            | undefined,
          payerEmail: mpPayment.payer.email ?? null,
          payerName: mpPayment.payer.firstName ?? null,
          paidAt: newStatus === 'APPROVED' ? now : null,
          tokenExpiresAt:
            newStatus === 'APPROVED'
              ? new Date(now.getTime() + COMPLETION_TOKEN_TTL_MS)
              : null,
          refundedAt: newStatus === 'REFUNDED' ? now : null,
        },
      });
      if (result.count === 0) return;
      didTransition = true;
      transitionedPaymentId = local.id;

      if (newStatus === 'APPROVED') {
        await this.persistRecoveryNotification(tx, local.id, mpPayment);
      }
    });

    // Post-commit side-effects (NOT inside the TX — Redis & WhatsApp must
    // not roll back with the DB).
    if (didTransition && newStatus === 'APPROVED' && transitionedPaymentId) {
      // Admin alert if we couldn't capture an email — needs to leave the TX
      // because AdminAlertsService writes its own Notification row.
      if (!mpPayment.payer.email) {
        await this.adminAlerts.notify({
          type: 'PAYMENT_NO_EMAIL',
          message: `Pago ${transitionedPaymentId} aprobado sin email de payer. ID MP: ${mpPayment.id}. Contactá al usuario manualmente.`,
        });
      }
      // Delayed orphan-alert. jobId guarantees dedup across webhook retries.
      await this.enqueueOrphanAlert(transitionedPaymentId);
      void this.audit.log({
        action: 'payment.webhook_approved',
        entity: 'payment',
        entityId: transitionedPaymentId,
        changes: { mpPaymentId: mpPayment.id },
      });
    }

    if (didTransition && newStatus === 'REFUNDED' && transitionedPaymentId) {
      await this.adminAlerts.notify({
        type: 'CHARGEBACK',
        message: `Chargeback/refund recibido: payment MP ${mpPayment.id} (local ${transitionedPaymentId}). Decidí qué hacer manualmente.`,
      });
      void this.audit.log({
        action: 'payment.refund_received',
        entity: 'payment',
        entityId: transitionedPaymentId,
        changes: { mpPaymentId: mpPayment.id },
      });
    }

    return { received: true };
  }

  /**
   * Inline notification persistence inside the webhook TX. Uses upsert
   * on `dedupKey` so a duplicate webhook (which won't transition the
   * payment anyway) wouldn't have produced a second row even if the
   * idempotency guard above failed open.
   *
   * Important nuance: when MP didn't return a payer email, we still
   * persist the row (with `toAddress=null`) so the audit trail is
   * complete; the worker marks it SKIPPED. The admin gets a separate
   * direct alert above.
   */
  private async persistRecoveryNotification(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    paymentId: string,
    mpPayment: ProviderPayment,
  ): Promise<void> {
    const tokenPlain = mpPayment.metadata.completionToken;
    const dedupKey = `recovery:${paymentId}`;

    const message = tokenPlain
      ? `Completá tu registro: ${this.env.FRONTEND_URL}/completar-registro?token=${tokenPlain}`
      : 'Tu pago se confirmó pero hay un problema técnico para generar el link. Te contactará el admin del club.';

    await tx.notification.upsert({
      where: { dedupKey },
      create: {
        userId: null,
        toAddress: mpPayment.payer.email ?? null,
        type: 'REGISTRATION_PENDING_RECOVERY',
        title: 'Tu inscripción está casi lista',
        message,
        channel: 'EMAIL',
        status: 'PENDING',
        dedupKey,
      },
      update: {}, // no-op on dup
    });
  }

  /**
   * Encolates the delayed admin-orphan-alert job. BullMQ uses `jobId` for
   * dedup at queue level — submitting the same id twice is a no-op until
   * the original job is removed. Combined with the per-payment dedup key
   * this gives us a "fires at most once per paymentId" guarantee even if
   * MP retries the webhook.
   */
  private async enqueueOrphanAlert(paymentId: string): Promise<void> {
    try {
      await this.notificationsQueue.add(
        ADMIN_ORPHAN_ALERT_JOB,
        { paymentId },
        {
          delay: ADMIN_ORPHAN_ALERT_DELAY_MS,
          jobId: toJobId('orphan-alert', paymentId),
          removeOnComplete: { age: 24 * 60 * 60 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    } catch (err) {
      // Don't fail the webhook because Redis hiccupped — the daily orphan
      // summary cron (Task 5.9) is the safety net.
      this.logger.warn(
        `Failed to enqueue admin-orphan-alert for ${paymentId}: ${(err as Error).message}`,
      );
    }
  }
}
