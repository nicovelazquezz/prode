import { Injectable, Logger } from '@nestjs/common';
import type { Phase } from '../../../generated/prisma/enums.js';

/**
 * Stub for the phase-progression orchestrator. The fully fleshed-out
 * `maybeClosePhase` (count pending matches → compute winner → idempotent
 * insert → trigger next-phase population → enqueue phase-winner notif)
 * arrives in Task 8.7. Until then, this stub keeps `ScoringService` (Task
 * 8.3) wireable without forwardRef gymnastics — calling `maybeClosePhase`
 * is simply a no-op that logs the phase being checked.
 *
 * Why a stub now instead of staging the dependency in 8.7: `ScoringService`
 * MUST call `maybeClosePhase` post-commit per spec 6.3, and pretending the
 * call site doesn't exist would produce a half-tested integration. The
 * stub records intent; the real implementation lands one task later.
 */
@Injectable()
export class PhaseService {
  private readonly logger = new Logger(PhaseService.name);

  async maybeClosePhase(phase: Phase): Promise<void> {
    // No-op stub — Task 8.7 replaces this body with the real logic.
    this.logger.debug(`[stub] maybeClosePhase(${phase}) called — no-op until Task 8.7`);
  }
}
