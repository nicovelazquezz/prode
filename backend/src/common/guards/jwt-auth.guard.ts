import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../../generated/prisma/client.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';

/**
 * Minimum surface the guard needs to verify an access token. `AuthService`
 * implements this contract; tests can swap in a mock verifier.
 */
export interface AccessTokenVerifier {
  verifyAccessToken(token: string): { sub: string; role: Role } | null;
}

/**
 * DI token used to register and resolve the `AccessTokenVerifier`. We use a
 * string token instead of importing `AuthService` directly to keep the
 * guard module-agnostic and unit-testable in isolation.
 */
export const ACCESS_TOKEN_VERIFIER = 'ACCESS_TOKEN_VERIFIER';

interface RequestLike {
  headers: { authorization?: string | string[] };
  user?: AuthenticatedUser;
}

/**
 * Verifies `Authorization: Bearer <jwt>` headers and attaches the decoded
 * user to `request.user`. Routes (or controllers) marked with `@Public()`
 * bypass the check entirely.
 *
 * Wired as a global guard in `main.ts`; individual handlers don't need to
 * apply it manually.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestLike>();
    const raw = req.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Empty bearer token');
    }

    const payload = this.verifier.verifyAccessToken(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    req.user = { id: payload.sub, role: payload.role };
    return true;
  }
}
