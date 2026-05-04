import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
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
}
