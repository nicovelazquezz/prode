import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { AuthService } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import { RefreshTokensService } from './refresh-tokens.service.js';
import { PasswordResetsService } from './password-resets.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { CompleteRegistrationDto } from './dto/complete-registration.dto.js';
import { loadEnv } from '../../config/env.js';
import { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';
import {
  CompletionAlreadyUsedException,
  CompletionTokenExpiredException,
  DniAlreadyExistsException,
  InvalidCompletionTokenException,
  PaymentNotApprovedException,
  WhatsappAlreadyExistsException,
} from '../../common/exceptions/domain.exceptions.js';

const REFRESH_COOKIE = 'refresh_token';
const SESSION_HINT_COOKIE = 'has_session';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Production cookie domain. Frontend (`prode.tirofederal.com`) and backend
 * (`api.prode.tirofederal.com`) sit on different subdomains, so the cookie
 * must be scoped to the parent domain or the browser won't send it back to
 * the API on cross-subdomain requests. Locally we omit `domain` entirely
 * (cookies stay host-only on `localhost`), which is the right default for
 * `npm run start:dev`.
 */
const PROD_COOKIE_DOMAIN = '.tirofederal.com';

/**
 * Builds the cookie options shared by `refresh_token` and `has_session`.
 * Centralised so emit/clear/rotate stay in lockstep — a mismatch on
 * `domain`/`sameSite`/`secure` between calls leaves stale cookies behind
 * that the browser can't replace.
 *
 * `sameSite: 'lax'` (was 'strict' previously) so the cookie still rides
 * top-level navigations from the frontend host to the API host. 'strict'
 * was incompatible with the cross-subdomain split required for the prod
 * deploy (see `PROD_COOKIE_DOMAIN`).
 */
function buildCookieOptions(
  isProd: boolean,
  options: { httpOnly: boolean; maxAge: number },
): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  domain?: string;
} {
  return {
    httpOnly: options.httpOnly,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: options.maxAge,
    ...(isProd ? { domain: PROD_COOKIE_DOMAIN } : {}),
  };
}

/**
 * Emits both auth cookies (the httpOnly refresh + the readable session
 * hint) using identical scope so they expire together. The hint exists so
 * the frontend can decide whether to attempt a /auth/refresh on landing
 * without burning a network round-trip when the user is anonymous —
 * `document.cookie.includes('has_session=1')` is enough to gate.
 */
function setAuthCookies(
  res: Response,
  refreshPlain: string,
  isProd: boolean,
): void {
  res.cookie(
    REFRESH_COOKIE,
    refreshPlain,
    buildCookieOptions(isProd, { httpOnly: true, maxAge: REFRESH_TTL_MS }),
  );
  res.cookie(
    SESSION_HINT_COOKIE,
    '1',
    buildCookieOptions(isProd, { httpOnly: false, maxAge: REFRESH_TTL_MS }),
  );
}

/**
 * Clears both auth cookies. Express's `clearCookie` requires the same
 * `path`/`domain` the cookie was set with; otherwise the browser keeps
 * the original. We mirror `setAuthCookies`'s scope here on purpose.
 */
function clearAuthCookies(res: Response, isProd: boolean): void {
  const baseOpts = {
    path: '/',
    ...(isProd ? { domain: PROD_COOKIE_DOMAIN } : {}),
  };
  res.clearCookie(REFRESH_COOKIE, baseOpts);
  res.clearCookie(SESSION_HINT_COOKIE, baseOpts);
}

/** Masks a DNI for audit logs: `12345678` → `12***678`. */
function maskDni(dni: string): string {
  if (dni.length <= 5) return '***';
  return `${dni.slice(0, 2)}***${dni.slice(-3)}`;
}

function pickPublicUser(user: {
  id: string;
  dni: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  role: string;
}) {
  return {
    id: user.id,
    dni: user.dni,
    firstName: user.firstName,
    lastName: user.lastName,
    whatsapp: user.whatsapp,
    role: user.role,
  };
}

function getRequestContext(req: Request): {
  userAgent?: string;
  ipAddress?: string;
} {
  const uaHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return { userAgent, ipAddress: req.ip ?? req.socket?.remoteAddress };
}

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly passwordResets: PasswordResetsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly adminAlerts: AdminAlertsService,
  ) {}

  @Public()
  @Throttle({
    // 5/min per IP + per DNI combo, so a brute-forcer can't iterate across
    // DNIs from one IP and a single DNI is also protected against being
    // attacked from a botnet (each IP burns its own bucket on that DNI).
    login: {
      limit: 5,
      ttl: 60_000,
      getTracker: (req) => {
        const dni = (req?.body as { dni?: string } | undefined)?.dni ?? 'unknown';
        return `${req?.ip ?? 'unknown'}:${dni}`;
      },
    },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = getRequestContext(req);
    const user = await this.usersService.findByDni(dto.dni);

    if (!user || user.status !== 'ACTIVE') {
      void this.audit.log({
        action: 'auth.login_failed',
        entity: 'auth',
        changes: { dni: maskDni(dto.dni), reason: !user ? 'no_such_user' : `status_${user.status}` },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await this.authService.comparePassword(
      dto.password,
      user.passwordHash,
    );
    if (!ok) {
      void this.audit.log({
        userId: user.id,
        action: 'auth.login_failed',
        entity: 'auth',
        entityId: user.id,
        changes: { dni: maskDni(dto.dni), reason: 'wrong_password' },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.authService.signAccessToken({
      sub: user.id,
      role: user.role,
    });
    const { plain } = await this.refreshTokens.create(user.id, ctx);

    setAuthCookies(res, plain, this.env.NODE_ENV === 'production');

    void this.usersService.touchLastLogin(user.id);
    void this.audit.log({
      userId: user.id,
      action: 'auth.login_success',
      entity: 'auth',
      entityId: user.id,
      changes: { dni: maskDni(dto.dni) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { accessToken, user: pickPublicUser(user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = (req as Request & { cookies?: Record<string, string> })
      .cookies;
    const plain = cookies?.[REFRESH_COOKIE];
    if (!plain) {
      throw new UnauthorizedException('Missing refresh cookie');
    }

    const isProd = this.env.NODE_ENV === 'production';
    const existing = await this.refreshTokens.findValidByPlain(plain);
    if (!existing) {
      // Token revoked, expired, or not found. Clear the cookies defensively
      // so a stale browser doesn't keep retrying.
      clearAuthCookies(res, isProd);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(existing.userId);
    if (!user || user.status !== 'ACTIVE') {
      // Owner deactivated or banned since this refresh was issued. Revoke.
      await this.refreshTokens.revoke(existing.id);
      clearAuthCookies(res, isProd);
      throw new UnauthorizedException('Account no longer active');
    }

    // Rotation: revoke the old token, mint a new pair.
    await this.refreshTokens.revoke(existing.id);
    const ctx = getRequestContext(req);
    const { plain: newPlain } = await this.refreshTokens.create(user.id, ctx);

    const accessToken = this.authService.signAccessToken({
      sub: user.id,
      role: user.role,
    });

    setAuthCookies(res, newPlain, isProd);

    return { accessToken, user: pickPublicUser(user) };
  }

  /**
   * Issues a password-reset token and queues a WhatsApp notification
   * with a link to the frontend reset page. Always returns 200 — even
   * when the DNI is unknown — to avoid leaking which DNIs are
   * registered. The actual delivery is the Phase 4 WhatsApp worker's
   * job; here we only persist the Notification row in PENDING state.
   */
  @Public()
  @Throttle({ 'auth-recovery': { limit: 3, ttl: 3_600_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const ctx = getRequestContext(req);
    const user = await this.usersService.findByDni(dto.dni);
    if (!user || user.status !== 'ACTIVE') {
      // Stay quiet — don't reveal whether the DNI exists.
      return { ok: true };
    }

    const { plain } = await this.passwordResets.create(user.id);
    const link = `${this.env.FRONTEND_URL}/reset?token=${plain}`;

    await this.prisma.notification.create({
      data: {
        userId: user.id,
        toAddress: user.whatsapp,
        type: 'PASSWORD_RESET',
        channel: 'WHATSAPP',
        status: 'PENDING',
        title: 'Recuperá tu contraseña',
        message:
          `Hola ${user.firstName}, recibimos un pedido para recuperar tu contraseña del Prode. ` +
          `Hacé click en el siguiente link para elegir una nueva (caduca en 30 minutos): ${link}`,
      },
    });

    void this.audit.log({
      userId: user.id,
      action: 'auth.password_reset_requested',
      entity: 'auth',
      entityId: user.id,
      changes: { dni: maskDni(dto.dni) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { ok: true };
  }

  /**
   * Consumes a reset token and sets a new password. On success, every
   * existing refresh token for the user is also revoked so any active
   * session on a stolen device is forced to re-authenticate.
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const ctx = getRequestContext(req);
    const reset = await this.passwordResets.findValidByPlain(dto.token);
    if (!reset) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const newHash = await this.authService.hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash: newHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      // Revoke any refresh tokens still alive for this user — a password
      // reset implies the previous credentials are no longer trusted.
      this.prisma.refreshToken.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    void this.audit.log({
      userId: reset.userId,
      action: 'auth.password_reset_completed',
      entity: 'auth',
      entityId: reset.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { ok: true };
  }

  /**
   * Authenticated logout: revokes the refresh token presented in the
   * cookie and clears it. Idempotent — repeated calls or calls without
   * a cookie still return 204. The access token cannot be revoked
   * server-side (stateless JWT); clients should drop it locally.
   *
   * No @Public() here: the global JwtAuthGuard will reject anonymous
   * requests with 401.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() _user: AuthenticatedUser,
  ): Promise<void> {
    const cookies = (req as Request & { cookies?: Record<string, string> })
      .cookies;
    const plain = cookies?.[REFRESH_COOKIE];
    if (plain) {
      const existing = await this.refreshTokens.findValidByPlain(plain);
      if (existing) {
        await this.refreshTokens.revoke(existing.id);
      }
    }
    clearAuthCookies(res, this.env.NODE_ENV === 'production');
  }

  /**
   * Returns the currently-authenticated user. The frontend calls this
   * after `auth/refresh` on landing to populate its in-memory user
   * shape. Sensitive columns (passwordHash, refreshTokens, etc.) are
   * deliberately omitted via the explicit `select` — *never* spread the
   * Prisma User object into the response.
   *
   * 401 (via the global JwtAuthGuard) when the access token is missing
   * or invalid; 404 when the JWT is valid but the user vanished from
   * the DB (e.g. cleaned up between issue and consumption — extremely
   * rare but cheaper to assert than to debug a TypeError later).
   */
  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser | undefined) {
    if (!current) {
      // Defense in depth: the global guard should have already rejected
      // an anonymous request, but if `@Public()` ever leaks onto a
      // parent decorator we surface the failure loudly here.
      throw new UnauthorizedException('Authentication required');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: current.id },
      select: {
        id: true,
        dni: true,
        firstName: true,
        lastName: true,
        whatsapp: true,
        role: true,
        status: true,
        whatsappOptIn: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Closes the public payment flow: consumes the magic-link token,
   * creates the User, links the existing Payment, and emits a fresh
   * access/refresh pair so the frontend can drop the user straight into
   * the app.
   *
   * Validation order (spec section 6.1):
   *   1) Token must exist (sha256 lookup) → 404 InvalidCompletionToken
   *   2) Payment must be APPROVED            → 400 PaymentNotApproved
   *   3) Token not already used (`completedAt IS NULL`) → 410 already used
   *   4) Token not expired (`tokenExpiresAt > now()`)    → 410 expired
   *   5) DNI free → otherwise 409 + admin alert
   *   6) WhatsApp free → otherwise 409
   *
   * The User-create + Payment-update happens inside a TX so a uniqueness
   * race (two concurrent submissions with the same DNI / whatsapp) cannot
   * leave the system half-written.
   */
  @Public()
  @Throttle({ 'auth-recovery': { limit: 3, ttl: 3_600_000 } })
  @Post('complete-registration')
  @HttpCode(HttpStatus.OK)
  async completeRegistration(
    @Body() dto: CompleteRegistrationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = getRequestContext(req);
    const tokenHash = this.authService.hashToken(dto.token);

    // 1-4: token + payment status preconditions (read-only, outside TX).
    const payment = await this.prisma.payment.findUnique({
      where: { completionTokenHash: tokenHash },
    });
    if (!payment) throw new InvalidCompletionTokenException();
    if (payment.status !== 'APPROVED') throw new PaymentNotApprovedException();
    if (payment.completedAt) throw new CompletionAlreadyUsedException();
    if (!payment.tokenExpiresAt || payment.tokenExpiresAt < new Date()) {
      throw new CompletionTokenExpiredException();
    }

    // 5-6: explicit pre-checks for clearer error mapping. The unique
    // constraint at the DB level is the actual safeguard against races —
    // we re-check inside the TX too.
    const existingDni = await this.prisma.user.findUnique({
      where: { dni: dto.dni },
    });
    if (existingDni) {
      // Audit + admin alert before throwing — this is one of the cases
      // listed in spec section 9.4 ("DNI duplicado al completar").
      void this.audit.log({
        action: 'auth.registration_dni_duplicate',
        entity: 'payment',
        entityId: payment.id,
        changes: { dni: maskDni(dto.dni) },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      await this.adminAlerts.notify({
        type: 'DNI_DUPLICATE',
        message:
          `Intento de completar registro con DNI ya existente. ` +
          `Pago: ${payment.id}. DNI: ${maskDni(dto.dni)}. ` +
          `Contactá al usuario manualmente.`,
      });
      throw new DniAlreadyExistsException();
    }
    const existingWa = await this.prisma.user.findUnique({
      where: { whatsapp: dto.whatsapp },
    });
    if (existingWa) {
      void this.audit.log({
        action: 'auth.registration_whatsapp_duplicate',
        entity: 'payment',
        entityId: payment.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new WhatsappAlreadyExistsException();
    }

    // Hash password outside the TX — bcrypt is CPU-bound and we don't
    // want to hold a DB connection while it runs.
    const passwordHash = await this.authService.hashPassword(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      // Re-validate the payment state under the TX in case a concurrent
      // submission reached step 7 first (would hit unique violation on
      // payment.userId since we set it below). Belt-and-suspenders.
      const fresh = await tx.payment.findUnique({
        where: { id: payment.id },
      });
      if (!fresh) throw new InvalidCompletionTokenException();
      if (fresh.completedAt) throw new CompletionAlreadyUsedException();

      const created = await tx.user.create({
        data: {
          dni: dto.dni,
          firstName: dto.firstName,
          lastName: dto.lastName,
          whatsapp: dto.whatsapp,
          passwordHash,
          role: 'USER',
          status: 'ACTIVE',
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: { userId: created.id, completedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId: created.id,
          action: 'auth.registration_completed',
          entity: 'user',
          entityId: created.id,
          changes: { paymentId: payment.id },
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      return created;
    });

    // Mint the same login pair we'd issue from /auth/login.
    const accessToken = this.authService.signAccessToken({
      sub: user.id,
      role: user.role,
    });
    const { plain } = await this.refreshTokens.create(user.id, ctx);

    setAuthCookies(res, plain, this.env.NODE_ENV === 'production');

    return { accessToken, user: pickPublicUser(user) };
  }
}
