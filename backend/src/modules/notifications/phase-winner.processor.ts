import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import type { Phase } from '../../../generated/prisma/enums.js';

/**
 * BullMQ job name produced by `PhaseService.maybeClosePhase` when a
 * phase finishes and a `PhaseWinner` row is inserted. Re-exported here
 * so the dispatch table in `NotificationsProcessor` and any external
 * caller stay in sync (the value matches `PHASE_WINNER_JOB` exported
 * from `phase.service.ts`).
 */
export const PHASE_WINNER_JOB = 'phase-winner';

export interface PhaseWinnerJobData {
  phase: Phase;
  userId: string;
}

/**
 * Spanish labels for the `Phase` enum so the WhatsApp text reads
 * naturally ("¡Ganaste el premio de la fase Octavos de final!"). Kept
 * in this file because they're intentionally human-facing — putting
 * them next to the enum in `prisma/schema.prisma` would mix domain
 * with i18n.
 */
const PHASE_LABEL: Record<Phase, string> = {
  GROUPS: 'Fase de Grupos',
  ROUND_32: 'Treintaidosavos de final',
  ROUND_16: 'Octavos de final',
  QUARTERS: 'Cuartos de final',
  SEMIS: 'Semifinales',
  THIRD_PLACE: 'Tercer puesto',
  FINAL: 'Final',
};

/**
 * Handler for the `phase-winner` job. Fired (once) by
 * `PhaseService.maybeClosePhase` after the closing match of a phase.
 *
 * Behaviour:
 *   1. Read user (firstName + whatsapp + opt-in).
 *   2. Read PhaseWinner for the phase to confirm pointsEarned.
 *   3. If `whatsappOptIn=true`, enqueue a WhatsApp Notification with
 *      dedupKey `phase-winner:${phase}:${userId}` so a re-fired job
 *      (BullMQ retries, recálculo of last match, etc.) doesn't
 *      double-notify.
 *
 * Why a handler class instead of a `@Processor` decorator: see the
 * shared note in `OrphanAlertProcessor` — one BullMQ worker per queue,
 * and `NotificationsProcessor` routes by job name into this handler.
 */
@Injectable()
export class PhaseWinnerProcessor {
  private readonly logger = new Logger(PhaseWinnerProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Returns true if a Notification was enqueued, false on no-op. */
  async handle(job: Job<PhaseWinnerJobData>): Promise<boolean> {
    const { phase, userId } = job.data;
    if (!phase || !userId) {
      this.logger.warn(
        `phase-winner job ${job.id} missing phase or userId — skipping`,
      );
      return false;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        whatsapp: true,
        whatsappOptIn: true,
        status: true,
      },
    });
    if (!user) {
      this.logger.warn(
        `phase-winner: user ${userId} not found — skipping (orphaned phase winner row?)`,
      );
      return false;
    }
    if (user.status !== 'ACTIVE') {
      this.logger.warn(
        `phase-winner: user ${userId} not ACTIVE — skipping notification`,
      );
      return false;
    }
    if (!user.whatsappOptIn) {
      // Respect the opt-out — the PhaseWinner row stands on its own as
      // the canonical award record, the notification is the courtesy
      // ping. No fallback channel for now (email arrives as Phase 12).
      this.logger.log(
        `phase-winner: user ${userId} opted out of WhatsApp — skipping`,
      );
      return false;
    }

    const winner = await this.prisma.phaseWinner.findUnique({
      where: { phase },
      select: { pointsEarned: true, userId: true },
    });
    if (!winner) {
      this.logger.warn(
        `phase-winner: PhaseWinner row missing for ${phase} — skipping`,
      );
      return false;
    }
    if (winner.userId !== userId) {
      // Defensive: a re-issued/replayed job with a stale userId. The
      // PhaseWinner table is the source of truth — we never message
      // someone who is not currently the recorded winner.
      this.logger.warn(
        `phase-winner: stale job (phase=${phase} job-userId=${userId} ` +
          `db-userId=${winner.userId}) — skipping`,
      );
      return false;
    }

    const phaseLabel = PHASE_LABEL[phase];
    const message =
      `🏆 ¡Felicitaciones ${user.firstName}! Ganaste el premio de la ` +
      `fase ${phaseLabel} con ${winner.pointsEarned} pts. Te ` +
      `contactaremos para coordinar el premio.`;

    await this.notifications.enqueue({
      userId,
      toAddress: user.whatsapp,
      type: 'PHASE_WINNER',
      title: '¡Ganaste un premio del Prode!',
      message,
      channel: 'WHATSAPP',
      dedupKey: `phase-winner:${phase}:${userId}`,
    });

    this.logger.log(
      `phase-winner: enqueued WhatsApp notification for user=${userId} phase=${phase}.`,
    );
    return true;
  }
}
