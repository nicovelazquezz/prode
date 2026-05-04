import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';

/**
 * Job name for the delayed admin-orphan-alert. Mirrors the constant
 * exported from PaymentsService so producer + consumer never drift.
 */
export const ADMIN_ORPHAN_ALERT_JOB = 'admin-orphan-alert';

export interface OrphanAlertJobData {
  paymentId: string;
}

/**
 * Handler for the delayed `admin-orphan-alert` job (see Task 5.5 producer
 * in PaymentsService).
 *
 * Why a handler class instead of a `@Processor` decorator: the
 * `notifications` queue already has its own worker (NotificationsProcessor).
 * Spinning up a second BullMQ worker on the same queue would create a
 * scheduling race — both workers would compete for every job and silently
 * drop the ones whose name they don't recognise. Routing by job name
 * inside the existing worker is the safe pattern; this class encapsulates
 * the orphan-alert behaviour so it stays unit-testable on its own.
 *
 * Behaviour: 2hs after a payment transitioned to APPROVED, BullMQ fires
 * this job. We re-read the Payment; if `completedAt` is still null, the
 * user never came back and we ping the admin via WhatsApp so they can
 * follow up manually. If the user *did* register in the meantime, the
 * job is a no-op.
 */
@Injectable()
export class OrphanAlertProcessor {
  private readonly logger = new Logger(OrphanAlertProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminAlerts: AdminAlertsService,
  ) {}

  /** Returns true if an alert was actually fired, false on no-op. */
  async handle(job: Job<OrphanAlertJobData>): Promise<boolean> {
    const { paymentId } = job.data;
    if (!paymentId) {
      this.logger.warn(
        `admin-orphan-alert job ${job.id} missing paymentId — skipping`,
      );
      return false;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        completedAt: true,
        status: true,
        payerEmail: true,
      },
    });
    if (!payment) {
      this.logger.warn(
        `admin-orphan-alert: payment ${paymentId} not found — skipping`,
      );
      return false;
    }
    if (payment.completedAt) {
      // The user came back and registered before the 2h window elapsed.
      return false;
    }
    if (payment.status !== 'APPROVED') {
      // Refunded, orphaned, or otherwise not actionable — leave it.
      return false;
    }

    await this.adminAlerts.notify({
      type: 'ADMIN_ALERT',
      // dedupKey ensures the per-payment alert lands at most once even if
      // the worker retries (BullMQ retries on throw — we don't, but
      // belt-and-suspenders).
      dedupKey: `orphan-alert-fired:${paymentId}`,
      message:
        `Pago ${payment.id} aprobado hace 2h pero el usuario no completó ` +
        `el registro. Email del payer: ${payment.payerEmail ?? 'sin email'}. ` +
        `Contactá al usuario para terminar la inscripción.`,
    });
    this.logger.log(`admin-orphan-alert fired for payment ${paymentId}.`);
    return true;
  }
}
