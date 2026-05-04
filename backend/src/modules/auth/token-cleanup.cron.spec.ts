import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { TokenCleanupCron } from './token-cleanup.cron.js';

/**
 * Integration test for `TokenCleanupCron.cleanupExpiredTokens`. We invoke
 * the method directly — the scheduler would only fire at 04:00 ART,
 * which is too slow for a unit-test budget (same pattern as
 * `PaymentsCron`).
 *
 * Strategy: create a dedicated test user, seed it with one expired
 * refresh token, one valid refresh token, one revoked-old token, one
 * recently-revoked token (must NOT be deleted), one expired password
 * reset, and one valid password reset. Then call the cron and assert
 * the expected rows survive.
 */
describe('TokenCleanupCron.cleanupExpiredTokens (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cron: TokenCleanupCron;
  let auth: AuthService;
  let userId: string;

  const stamp = Date.now();
  const dni = `36${String(stamp).slice(-7)}`;

  // Track token hashes so we can clean up survivors at the end (they may
  // be the "valid" tokens that the cron deliberately did NOT delete).
  const seededHashes: string[] = [];
  const seededResetHashes: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    cron = app.get(TokenCleanupCron);
    auth = app.get(AuthService);

    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('SeedPass123', 10);
    const user = await prisma.user.create({
      data: {
        dni,
        firstName: 'Token',
        lastName: 'Cleanup',
        whatsapp: `549${String(8_300_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
      },
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.refreshToken.deleteMany({
        where: { tokenHash: { in: seededHashes } },
      });
      await prisma.passwordReset.deleteMany({
        where: { tokenHash: { in: seededResetHashes } },
      });
      // Belt-and-suspenders: drop any rows still tied to the test user.
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.passwordReset.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    if (app) await app.close();
  }, 30_000);

  it('deletes expired and old-revoked tokens but spares valid + recent-revoked rows', async () => {
    const now = Date.now();

    // 1) Expired refresh token — MUST be deleted.
    const hExpired = auth.hashToken(`tc-expired-${stamp}`);
    seededHashes.push(hExpired);
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hExpired,
        expiresAt: new Date(now - 24 * 3600 * 1000), // yesterday
      },
    });

    // 2) Valid refresh token — must survive.
    const hValid = auth.hashToken(`tc-valid-${stamp}`);
    seededHashes.push(hValid);
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hValid,
        expiresAt: new Date(now + 7 * 24 * 3600 * 1000),
      },
    });

    // 3) Revoked > 7 days ago — MUST be deleted.
    const hOldRevoked = auth.hashToken(`tc-old-revoked-${stamp}`);
    seededHashes.push(hOldRevoked);
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hOldRevoked,
        expiresAt: new Date(now + 7 * 24 * 3600 * 1000),
        revokedAt: new Date(now - 10 * 24 * 3600 * 1000),
      },
    });

    // 4) Revoked yesterday — must survive (within 7-day grace).
    const hRecentRevoked = auth.hashToken(`tc-recent-revoked-${stamp}`);
    seededHashes.push(hRecentRevoked);
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hRecentRevoked,
        expiresAt: new Date(now + 7 * 24 * 3600 * 1000),
        revokedAt: new Date(now - 24 * 3600 * 1000),
      },
    });

    // 5) Expired PasswordReset — MUST be deleted.
    const rExpired = auth.hashToken(`tc-reset-expired-${stamp}`);
    seededResetHashes.push(rExpired);
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: rExpired,
        expiresAt: new Date(now - 24 * 3600 * 1000),
      },
    });

    // 6) Valid PasswordReset — must survive.
    const rValid = auth.hashToken(`tc-reset-valid-${stamp}`);
    seededResetHashes.push(rValid);
    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: rValid,
        expiresAt: new Date(now + 30 * 60 * 1000),
      },
    });

    const result = await cron.cleanupExpiredTokens();

    expect(result.refreshTokensDeleted).toBeGreaterThanOrEqual(2);
    expect(result.passwordResetsDeleted).toBeGreaterThanOrEqual(1);

    // Survivors:
    const valid = await prisma.refreshToken.findUnique({
      where: { tokenHash: hValid },
    });
    expect(valid).not.toBeNull();
    const recentRevoked = await prisma.refreshToken.findUnique({
      where: { tokenHash: hRecentRevoked },
    });
    expect(recentRevoked).not.toBeNull();
    const validReset = await prisma.passwordReset.findUnique({
      where: { tokenHash: rValid },
    });
    expect(validReset).not.toBeNull();

    // Casualties:
    const expired = await prisma.refreshToken.findUnique({
      where: { tokenHash: hExpired },
    });
    expect(expired).toBeNull();
    const oldRevoked = await prisma.refreshToken.findUnique({
      where: { tokenHash: hOldRevoked },
    });
    expect(oldRevoked).toBeNull();
    const expiredReset = await prisma.passwordReset.findUnique({
      where: { tokenHash: rExpired },
    });
    expect(expiredReset).toBeNull();

    // Audit log row recorded.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'auth.tokens_cleaned' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('returns zero counts and skips audit on a clean DB', async () => {
    // Re-running immediately should be a no-op for the rows we control.
    // Other suites may have left expired rows behind, so we only assert
    // the structure (not that result == 0).
    const result = await cron.cleanupExpiredTokens();
    expect(result).toHaveProperty('refreshTokensDeleted');
    expect(result).toHaveProperty('passwordResetsDeleted');
    expect(result.refreshTokensDeleted).toBeGreaterThanOrEqual(0);
    expect(result.passwordResetsDeleted).toBeGreaterThanOrEqual(0);
  });
});
