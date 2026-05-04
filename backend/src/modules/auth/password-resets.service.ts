import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { PasswordReset } from '../../../generated/prisma/client.js';

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Persists, validates, and consumes password-reset tokens. The plain
 * value travels out-of-band (WhatsApp link); only its sha256 hash is
 * stored in the database.
 */
@Injectable()
export class PasswordResetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Issues a new reset token for the given user. Returns the *plain*
   * value (to embed in the WhatsApp link) and the persisted row.
   */
  async create(userId: string): Promise<{ plain: string; record: PasswordReset }> {
    const plain = this.auth.generatePlainToken();
    const tokenHash = this.auth.hashToken(plain);
    const record = await this.prisma.passwordReset.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    return { plain, record };
  }

  /**
   * Looks up a reset token by hashing the plain value the user just
   * presented. Returns null if it doesn't exist, was already used, or
   * has expired.
   */
  async findValidByPlain(plain: string): Promise<PasswordReset | null> {
    const tokenHash = this.auth.hashToken(plain);
    const row = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
    });
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  }

  /**
   * Marks a reset row as consumed. Idempotent: re-marking is a no-op.
   */
  async markUsed(id: string): Promise<void> {
    await this.prisma.passwordReset.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
