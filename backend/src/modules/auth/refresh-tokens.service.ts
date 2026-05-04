import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { RefreshToken } from '../../../generated/prisma/client.js';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface RequestContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Persists, rotates, and revokes refresh tokens. The plain token value
 * never lives in the database — only its sha256 hash. The plain value
 * travels back to the client in an httpOnly cookie.
 */
@Injectable()
export class RefreshTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Generates a fresh plain token, hashes it, stores the hash with a
   * 7-day expiration, and returns *both* values: the plain (to set in a
   * cookie) and the persisted row (id + tokenHash for later revocation).
   */
  async create(userId: string, ctx: RequestContext = {}): Promise<{
    plain: string;
    record: RefreshToken;
  }> {
    const plain = this.auth.generatePlainToken();
    const tokenHash = this.auth.hashToken(plain);
    const record = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
      },
    });
    return { plain, record };
  }

  /**
   * Looks up a refresh token by hashing the plain value the client sent
   * us. Returns null if the token doesn't exist, was revoked, or has
   * expired — callers MUST treat null as "unauthorized".
   */
  async findValidByPlain(plain: string): Promise<RefreshToken | null> {
    const tokenHash = this.auth.hashToken(plain);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  }

  /**
   * Marks a single refresh token as revoked. Idempotent: re-revoking is
   * a no-op (`updateMany` with the `revokedAt: null` guard).
   */
  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
