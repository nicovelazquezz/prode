import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { AuthService } from './auth.service.js';
import { UsersService } from '../users/users.service.js';
import { RefreshTokensService } from './refresh-tokens.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginDto } from './dto/login.dto.js';
import { loadEnv } from '../../config/env.js';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
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

    res.cookie(REFRESH_COOKIE, plain, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TTL_MS,
      path: '/',
    });

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

    const existing = await this.refreshTokens.findValidByPlain(plain);
    if (!existing) {
      // Token revoked, expired, or not found. Clear the cookie defensively
      // so a stale browser doesn't keep retrying.
      res.clearCookie(REFRESH_COOKIE, { path: '/' });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(existing.userId);
    if (!user || user.status !== 'ACTIVE') {
      // Owner deactivated or banned since this refresh was issued. Revoke.
      await this.refreshTokens.revoke(existing.id);
      res.clearCookie(REFRESH_COOKIE, { path: '/' });
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

    res.cookie(REFRESH_COOKIE, newPlain, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TTL_MS,
      path: '/',
    });

    return { accessToken, user: pickPublicUser(user) };
  }

  /**
   * Authenticated logout: revokes the refresh token presented in the
   * cookie and clears it. Idempotent — repeated calls or calls without
   * a cookie still return 204. The access token cannot be revoked
   * server-side (stateless JWT); clients should drop it locally.
   */
  @UseGuards(JwtAuthGuard)
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
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }
}
