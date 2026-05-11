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

/**
 * Multi-prode (post v1.1): job payload carries the entryId. The owning
 * human user is resolved here via `Entry.userId` so the WhatsApp goes
 * to the right person; the alias of the entry is included in the
 * message body so a user with multiple prodes knows which one won.
 */
export interface PhaseWinnerJobData {
  phase: Phase;
  entryId: string;
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
 *   1. Resolve Entry → owning User (firstName + whatsapp + opt-in).
 *   2. Read PhaseWinner for the phase to confirm pointsEarned matches
 *      the entry referenced by the job (defensive against stale jobs).
 *   3. If `whatsappOptIn=true`, enqueue a WhatsApp Notification with
 *      dedupKey `phase-winner:${phase}:${entryId}` so a re-fired job
 *      doesn't double-notify.
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
    const { phase, entryId } = job.data;
    if (!phase || !entryId) {
      this.logger.warn(
        `phase-winner job ${job.id} missing phase or entryId — skipping`,
      );
      return false;
    }

    const entry = await this.prisma.entry.findUnique({
      where: { id: entryId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            whatsapp: true,
            whatsappOptIn: true,
            status: true,
          },
        },
      },
    });
    if (!entry) {
      this.logger.warn(
        `phase-winner: entry ${entryId} not found — skipping (orphaned phase winner row?)`,
      );
      return false;
    }
    const user = entry.user;
    if (user.status !== 'ACTIVE') {
      this.logger.warn(
        `phase-winner: user ${user.id} not ACTIVE — skipping notification`,
      );
      return false;
    }
    if (!user.whatsappOptIn) {
      // Respect the opt-out — the PhaseWinner row stands on its own as
      // the canonical award record, the notification is the courtesy
      // ping.
      this.logger.log(
        `phase-winner: user ${user.id} opted out of WhatsApp — skipping`,
      );
      return false;
    }

    const winner = await this.prisma.phaseWinner.findUnique({
      where: { phase },
      select: { pointsEarned: true, entryId: true },
    });
    if (!winner) {
      this.logger.warn(
        `phase-winner: PhaseWinner row missing for ${phase} — skipping`,
      );
      return false;
    }
    if (winner.entryId !== entryId) {
      // Defensive: a re-issued/replayed job with a stale entryId. The
      // PhaseWinner table is the source of truth — we never message
      // someone whose entry is not currently the recorded winner.
      this.logger.warn(
        `phase-winner: stale job (phase=${phase} job-entryId=${entryId} ` +
          `db-entryId=${winner.entryId}) — skipping`,
      );
      return false;
    }

    const phaseLabel = PHASE_LABEL[phase];
    const aliasSuffix = entry.alias
      ? ` con tu prode "${entry.alias}"`
      : entry.position > 1
        ? ` con tu prode #${entry.position}`
        : '';
    const message =
      `🏆 ¡Felicitaciones ${user.firstName}! Ganaste el premio de la ` +
      `fase ${phaseLabel}${aliasSuffix} con ${winner.pointsEarned} pts. Te ` +
      `contactaremos para coordinar el premio.`;

    await this.notifications.enqueue({
      userId: user.id,
      toAddress: user.whatsapp,
      type: 'PHASE_WINNER',
      title: '¡Ganaste un premio del Prode!',
      message,
      channel: 'WHATSAPP',
      dedupKey: `phase-winner:${phase}:${entryId}`,
    });

    this.logger.log(
      `phase-winner: enqueued WhatsApp notification for user=${user.id} entry=${entryId} phase=${phase}.`,
    );
    return true;
  }
}
