import { Injectable, Logger } from '@nestjs/common';
import { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';
import type { Phase } from '../../../generated/prisma/enums.js';

/**
 * Stub for the elimination-bracket populator. The fully fleshed-out
 * implementation lands in Task 8.8; this stub keeps `PhaseService` (Task
 * 8.7) wireable without forwardRef gymnastics.
 *
 * Each `populate*Matches` method is a no-op that pings the admin via
 * AdminAlerts so the operator knows manual intervention is needed (until
 * Task 8.8 lands or, in the simplification path described in the plan,
 * indefinitely).
 */
@Injectable()
export class MatchProgressionService {
  private readonly logger = new Logger(MatchProgressionService.name);

  constructor(private readonly adminAlerts: AdminAlertsService) {}

  async populateRound32Matches(): Promise<void> {
    await this.notifyManualReview('GROUPS', 'ROUND_32');
  }

  async populateRound16Matches(): Promise<void> {
    await this.notifyManualReview('ROUND_32', 'ROUND_16');
  }

  async populateQuarterMatches(): Promise<void> {
    await this.notifyManualReview('ROUND_16', 'QUARTERS');
  }

  async populateSemiMatches(): Promise<void> {
    await this.notifyManualReview('QUARTERS', 'SEMIS');
  }

  async populateFinalMatches(): Promise<void> {
    await this.notifyManualReview('SEMIS', 'FINAL');
  }

  private async notifyManualReview(from: Phase, to: Phase): Promise<void> {
    this.logger.warn(
      `[stub] populate${to}Matches called after ${from} closed — Task 8.8 stub`,
    );
    await this.adminAlerts.notify({
      type: 'PHASE_PROGRESSION_MANUAL_REVIEW',
      message:
        `Phase ${from} closed; ${to} matches need team assignments. ` +
        `Use PUT /admin/matches/:id to assign teams manually until Task 8.8 ` +
        `automates the bracket.`,
      dedupKey: `phase-progression:${from}->${to}`,
    });
  }
}
