import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import jwt, {
  type SignOptions,
  type JwtPayload as RawJwtPayload,
} from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '../../../generated/prisma/client.js';
import { loadEnv, type Env } from '../../config/env.js';
import type { AccessTokenVerifier } from '../../common/guards/jwt-auth.guard.js';

/** Decoded JWT we care about. */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export interface RefreshTokenPayload {
  sub: string;
}

/** Bcrypt cost — kept in sync with `prisma/seed-config.ts`. */
const BCRYPT_ROUNDS = 12;

/**
 * Stateless utility service grouping all auth-related primitives:
 * password hashing, JWT signing/verification, secure token generation,
 * and the sha256 helper used to store hashed tokens (refresh, password
 * reset) in the database.
 *
 * Stateless on purpose: every method is unit-testable in isolation and
 * does not touch the database.
 */
@Injectable()
export class AuthService implements AccessTokenVerifier {
  private readonly logger = new Logger(AuthService.name);
  private readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  // ── Passwords ────────────────────────────────────────────────────────

  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  // ── JWT ──────────────────────────────────────────────────────────────

  signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.env.JWT_ACCESS_SECRET, {
      expiresIn: this.env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
    });
  }

  signRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, this.env.JWT_REFRESH_SECRET, {
      expiresIn: this.env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      const decoded = jwt.verify(
        token,
        this.env.JWT_ACCESS_SECRET,
      ) as RawJwtPayload & Partial<AccessTokenPayload>;
      if (
        typeof decoded.sub !== 'string' ||
        (decoded.role !== 'USER' && decoded.role !== 'ADMIN')
      ) {
        return null;
      }
      return { sub: decoded.sub, role: decoded.role };
    } catch (err) {
      this.logger.debug(
        `Access token verification failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  verifyRefreshToken(token: string): RefreshTokenPayload | null {
    try {
      const decoded = jwt.verify(
        token,
        this.env.JWT_REFRESH_SECRET,
      ) as RawJwtPayload & Partial<RefreshTokenPayload>;
      if (typeof decoded.sub !== 'string') return null;
      return { sub: decoded.sub };
    } catch (err) {
      this.logger.debug(
        `Refresh token verification failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ── Opaque tokens (refresh / password reset) ────────────────────────

  /**
   * Generates a 64-hex-char random token. Used as the *plain* value sent
   * over an out-of-band channel (cookie, WhatsApp link). The DB only
   * stores `hashToken(plain)`.
   */
  generatePlainToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * SHA-256 hex digest of a plain opaque token. Deterministic so we can
   * look up records by hashing the value the user just presented.
   */
  hashToken(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }
}
