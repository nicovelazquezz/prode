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
import { ADMIN_ORPHAN_ALERT_JOB } from './orphan-alert.processor.js';
import { loadEnv, type Env } from '../../config/env.js';
import {
  CompletionAlreadyUsedException,
  CompletionTokenExpiredException,
  InvalidCompletionTokenException,
} from '../../common/exceptions/domain.exceptions.js';

/**
 * Default inscription price (ARS) used when `AppConfig.inscripcion_precio`
 * is missing. Matches the Phase 2 seed.
 */
const DEFAULT_AMOUNT_ARS = 15_000;

/**
 * Default cap for `AppConfig.max_entries_per_user`. Mirrors the value
 * used by EntriesService — duplicated so PaymentsService stays
 * decoupled from EntriesModule (and so the webhook works even if the
 * AppConfig row is missing).
 */
const DEFAULT_MAX_ENTRIES = 5;

/**
 * TTL of the magic link / completion token, applied when the Payment
 * transitions to APPROVED. Matches spec section 6.5 (7 days from paidAt).
 */
const COMPLETION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
   * Reads `AppConfig.max_entries_per_user`. Falls back to the spec
   * default. Used by the webhook re-check (logged-in "agregar otro
   * prode" flow). Accepts an optional TX client so the read can stay
   * inside the surrounding transaction for read-after-write
   * consistency with concurrent admin updates.
   */
  private async getMaxEntriesPerUser(
    tx?: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const row = await client.appConfig.findUnique({
      where: { key: 'max_entries_per_user' },
    });
    const raw = row?.value ?? String(DEFAULT_MAX_ENTRIES);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return DEFAULT_MAX_ENTRIES;
    }
    return Math.min(20, parsed);
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
    return this.applyProviderPayment(mpPayment);
  }

  /**
   * Applies a fully-resolved `ProviderPayment` to local state. Extracted
   * from `processWebhook` so the dev-only `POST /dev/simulate-webhook`
   * endpoint (NODE_ENV !== 'production') can drive the same TX +
   * notification + admin-alert pipeline without hitting MP's API or the
   * HMAC verification path.
   *
   * Production flow still goes through `processWebhook` → HMAC verify
   * (controller) → provider.getPayment → applyProviderPayment.
   *
   * Returns the same `{ received: true }` envelope so callers stay
   * interchangeable.
   */
  async applyProviderPayment(
    mpPayment: ProviderPayment,
  ): Promise<{ received: true }> {
    const newStatus = mpPayment.status;

    let didTransition = false;
    let transitionedPaymentId: string | null = null;
    /** Whether this webhook landed on a logged-in flow ("agregar otro prode"). */
    let isLoggedInFlow = false;
    /** Set when the cap re-check failed and the Payment was forced to OVER_CAP. */
    let overCapForUserId: string | null = null;
    /** Set when a new Entry was successfully created in the webhook TX. */
    let createdEntryId: string | null = null;

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
          `Webhook: payment not found locally (mp id=${mpPayment.id}, preferenceId=${mpPayment.preferenceId ?? '-'})`,
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
      isLoggedInFlow = local.userId !== null;

      if (newStatus === 'APPROVED') {
        if (local.userId) {
          // Logged-in "agregar otro prode" flow. Re-check cap (race
          // with admin lowering it between init and webhook), then
          // either create Entry or force the payment to OVER_CAP.
          const cap = await this.getMaxEntriesPerUser(tx);
          // Lock every entry of this user. PostgreSQL forbids
          // `SELECT COUNT(*) ... FOR UPDATE` ("FOR UPDATE is not allowed
          // with aggregate functions"), so we materialise the rows and
          // count in JS. The row-level locks are held until commit.
          const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM entries
            WHERE "userId" = ${local.userId}
            FOR UPDATE
          `;
          const current = lockedRows.length;
          if (current >= cap) {
            await tx.payment.update({
              where: { id: local.id },
              data: { status: 'OVER_CAP' },
            });
            await tx.auditLog.create({
              data: {
                userId: local.userId,
                action: 'entry.over_cap_orphaned',
                entity: 'payment',
                entityId: local.id,
                changes: { current, cap, mpPaymentId: mpPayment.id },
              },
            });
            overCapForUserId = local.userId;
            // Do NOT persist the recovery notification — the user is
            // already logged in, the payment failed to materialise.
          } else {
            const maxPos = await tx.entry.aggregate({
              where: { userId: local.userId },
              _max: { position: true },
            });
            const nextPosition = (maxPos._max.position ?? 0) + 1;
            const entry = await tx.entry.create({
              data: {
                userId: local.userId,
                paymentId: local.id,
                position: nextPosition,
                alias: local.entryAlias,
                status: 'ACTIVE',
              },
            });
            createdEntryId = entry.id;
            await tx.auditLog.create({
              data: {
                userId: local.userId,
                action: 'entry.created',
                entity: 'entry',
                entityId: entry.id,
                changes: {
                  paymentId: local.id,
                  position: nextPosition,
                  source: 'webhook',
                  alias: local.entryAlias,
                },
              },
            });
          }
        } else {
          // Public flow (anonymous): persist the recovery email so the
          // user can click through and complete registration.
          await this.persistRecoveryNotification(tx, local.id, mpPayment);
        }
      }
    });

    // Post-commit side-effects (NOT inside the TX — Redis & WhatsApp must
    // not roll back with the DB).
    if (didTransition && newStatus === 'APPROVED' && transitionedPaymentId) {
      if (overCapForUserId) {
        // OVER_CAP path: alert admin to refund manually. The Entry was
        // never created so the user paid for nothing — admin decides
        // refund vs raise the cap.
        await this.adminAlerts.notify({
          type: 'PAYMENT_OVER_CAP',
          message:
            `Payment ${transitionedPaymentId} aprobado pero el user ${overCapForUserId} ` +
            `está al cap de entries. Decidí refund o raise del cap. ID MP: ${mpPayment.id}.`,
        });
        void this.audit.log({
          action: 'payment.over_cap',
          entity: 'payment',
          entityId: transitionedPaymentId,
          changes: { userId: overCapForUserId, mpPaymentId: mpPayment.id },
        });
      } else if (isLoggedInFlow) {
        // Logged-in flow + Entry created — no recovery email, no
        // delayed orphan alert (the entry already exists).
        void this.audit.log({
          action: 'payment.webhook_approved',
          entity: 'payment',
          entityId: transitionedPaymentId,
          changes: {
            mpPaymentId: mpPayment.id,
            entryId: createdEntryId,
            flow: 'logged_in',
          },
        });
      } else {
        // Public flow — same behaviour as before.
        if (!mpPayment.payer.email) {
          await this.adminAlerts.notify({
            type: 'PAYMENT_NO_EMAIL',
            message: `Pago ${transitionedPaymentId} aprobado sin email de payer. ID MP: ${mpPayment.id}. Contactá al usuario manualmente.`,
          });
        }
        await this.enqueueOrphanAlert(transitionedPaymentId);
        void this.audit.log({
          action: 'payment.webhook_approved',
          entity: 'payment',
          entityId: transitionedPaymentId,
          changes: { mpPaymentId: mpPayment.id, flow: 'public' },
        });
      }
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

  // ── Public token lookup ──────────────────────────────────────────────

  /**
   * Resolves the public state of a Payment given the **plain** completion
   * token. Used by the frontend's `/completar-registro` page to decide
   * whether to render the form or an error state.
   *
   * Returns the same shape regardless of branch (status / expiresAt /
   * completed / hasPayer) — never leaks payer email, name, amount, or
   * any internal id.
   *
   * Error mapping (spec section 13.7):
   *   - unknown token  → 404 InvalidCompletionTokenException
   *   - expired token  → 410 CompletionTokenExpiredException
   *   - already used   → 410 CompletionAlreadyUsedException
   */
  async findByToken(plainToken: string): Promise<{
    status: string;
    expiresAt: Date | null;
    completed: boolean;
    hasPayer: boolean;
  }> {
    const tokenHash = this.authService.hashToken(plainToken);
    const payment = await this.prisma.payment.findUnique({
      where: { completionTokenHash: tokenHash },
      select: {
        status: true,
        completedAt: true,
        tokenExpiresAt: true,
        payerEmail: true,
      },
    });
    if (!payment) {
      throw new InvalidCompletionTokenException();
    }
    if (payment.completedAt) {
      throw new CompletionAlreadyUsedException();
    }
    if (payment.tokenExpiresAt && payment.tokenExpiresAt < new Date()) {
      throw new CompletionTokenExpiredException();
    }
    return {
      status: payment.status,
      expiresAt: payment.tokenExpiresAt,
      completed: false,
      hasPayer: !!payment.payerEmail,
    };
  }
}
