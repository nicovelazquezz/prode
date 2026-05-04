import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MatchStatus } from '../../../generated/prisma/enums.js';

/**
 * Per-minute cron jobs that own match-state transitions:
 *
 *   - {@link autoLockMatches}: flips SCHEDULED → LOCKED once kickoff is
 *     within the lock window. Runs frequently because the granularity of
 *     the lock window is small (10 min) and missing a tick would let the
 *     prediction page accept writes after we promised the user it was shut.
 *
 *   - {@link lockSpecialPredictions}: locks every `SpecialPrediction` row
 *     once the inaugural match (matchNumber=1) hits its lock time. This
 *     gate is shared across all users — runs once at tournament start,
 *     no-ops every minute thereafter.
 *
 * Audit logs are deliberately skipped here: the auto-lock fires for ~104
 * matches across 30+ days and would flood `audit_logs` with low-signal
 * rows. The transition is observable through `Match.status` directly and
 * the cron logs an aggregate `count` for ops.
 */
@Injectable()
export class MatchesCron {
  private readonly logger = new Logger(MatchesCron.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the count of matches that flipped to LOCKED, useful for both
   * tests and operator-facing logs. The query is index-friendly: the
   * `(status, kickoffAt)` composite index from spec 5.5 matches the
   * `where` exactly.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async autoLockMatches(): Promise<number> {
    const result = await this.prisma.match.updateMany({
      where: {
        status: MatchStatus.SCHEDULED,
        predictionsLockAt: { lte: new Date() },
      },
      data: { status: MatchStatus.LOCKED },
    });
    if (result.count > 0) {
      this.logger.log(`Auto-locked ${result.count} match(es)`);
    }
    return result.count;
  }
}
