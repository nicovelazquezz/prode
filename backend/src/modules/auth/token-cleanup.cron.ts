import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Schedule expressions are interpreted in the process timezone. Production
 * containers run with `TZ=America/Argentina/Buenos_Aires`; we still pass
 * the explicit `timeZone` here so the cron fires at 04:00 ART regardless
 * of the host's local time (e.g. CI runners on UTC).
 */
const ART_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Grace period for revoked refresh tokens. Tokens revoked within this
 * window stay around so an admin investigating a security incident can
 * see who was logged in where; older revoked rows have no audit value
 * left and just bloat the table.
 */
const REFRESH_REVOKED_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Daily cron at 04:00 ART that purges:
 *
 *   - `RefreshToken` rows that are EITHER expired OR revoked > 7 days ago.
 *   - `PasswordReset` rows that are expired (no grace — these are sensitive
 *     and a real reset is short-lived; keeping them post-expiry adds risk
 *     without any operational benefit).
 *
 * Audit logs the deletion counts in a single row per table so the trail
 * stays compact (we don't audit per-row — that would explode the
 * `audit_logs` table for what is otherwise routine housekeeping).
 *
 * Returns the per-table delete counts for tests + ops logs.
 */
@Injectable()
export class TokenCleanupCron {
  private readonly logger = new Logger(TokenCleanupCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron('0 4 * * *', { timeZone: ART_TZ })
  async cleanupExpiredTokens(): Promise<{
    refreshTokensDeleted: number;
    passwordResetsDeleted: number;
  }> {
    const now = new Date();
    const revokedCutoff = new Date(now.getTime() - REFRESH_REVOKED_GRACE_MS);

    // RefreshToken: expired OR (revoked & past grace).
    const refreshDelete = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { not: null, lt: revokedCutoff } },
        ],
      },
    });

    // PasswordReset: just-expired rows (no grace).
    const resetDelete = await this.prisma.passwordReset.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    if (refreshDelete.count > 0 || resetDelete.count > 0) {
      this.logger.log(
        `Token cleanup: deleted ${refreshDelete.count} refresh token(s) and ` +
          `${resetDelete.count} password reset(s).`,
      );
      await this.audit.log({
        action: 'auth.tokens_cleaned',
        entity: 'auth',
        entityId: null,
        changes: {
          refreshTokensDeleted: refreshDelete.count,
          passwordResetsDeleted: resetDelete.count,
          revokedCutoff,
        },
      });
    }

    return {
      refreshTokensDeleted: refreshDelete.count,
      passwordResetsDeleted: resetDelete.count,
    };
  }
}
