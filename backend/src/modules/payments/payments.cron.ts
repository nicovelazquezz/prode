import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Schedule expressions are interpreted in the process timezone. The
 * deployed container runs with `TZ=America/Argentina/Buenos_Aires`
 * (spec section 11), so passing the explicit `timeZone` here is
 * defensive — same effect locally regardless of host TZ.
 */
const ART_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Cron jobs for the public payment flow.
 *
 *   - 03:00 ART daily — mark APPROVED-but-never-completed payments as
 *     ORPHANED once their magic-link TTL has lapsed. Frees the DNI/whatsapp
 *     uniqueness slot conceptually (the user never claimed them) and feeds
 *     the daily summary cron below.
 *
 *   - 09:00 ART daily — count yesterday's freshly-orphaned payments and
 *     ping the admin via AdminAlerts so they can reach out manually.
 *
 * Both jobs are idempotent in spirit: re-running mid-day is a no-op
 * because `updateMany` only flips PENDING-criteria rows, and the summary
 * counts a closed window.
 */
@Injectable()
export class PaymentsCron {
  private readonly logger = new Logger(PaymentsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Picks up payments that:
   *   - are APPROVED (the user paid),
   *   - have no linked user (`userId` IS NULL — never completed register),
   *   - whose completion-token TTL has passed (`tokenExpiresAt < now()`).
   *
   * Flips them to ORPHANED so the daily summary picks them up. We do NOT
   * touch the User table (there isn't one yet by definition) or attempt
   * any refund — that's an admin call.
   *
   * Returns the count flipped so tests can assert directly without
   * re-querying. Public so the integration test can drive it.
   */
  @Cron('0 3 * * *', { timeZone: ART_TZ })
  async cleanupOrphanedPayments(): Promise<number> {
    const now = new Date();
    const targets = await this.prisma.payment.findMany({
      where: {
        status: 'APPROVED',
        userId: null,
        tokenExpiresAt: { lt: now },
      },
      select: { id: true },
    });
    if (targets.length === 0) return 0;

    const result = await this.prisma.payment.updateMany({
      where: { id: { in: targets.map((p) => p.id) } },
      data: { status: 'ORPHANED' },
    });

    // One audit entry per payment so the audit trail shows each transition
    // explicitly (the spec requires `payment.marked_orphaned` to be audited).
    await Promise.all(
      targets.map((p) =>
        this.audit.log({
          action: 'payment.marked_orphaned',
          entity: 'payment',
          entityId: p.id,
          changes: { reason: 'token_expired_no_user' },
        }),
      ),
    );

    this.logger.log(
      `Marked ${result.count} payments ORPHANED (token expired without registration).`,
    );
    return result.count;
  }
}
