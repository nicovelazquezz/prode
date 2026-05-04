import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../../generated/prisma/client.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';

interface RequestLike {
  user?: AuthenticatedUser;
}

/**
 * Reads `@Roles(...)` metadata and rejects requests whose authenticated
 * user does not match any of the declared roles. Assumes `JwtAuthGuard`
 * has already populated `request.user` (it must run before this guard).
 *
 * If no `@Roles()` metadata is set, the guard is a no-op (allow).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestLike>();
    const user = req.user;
    if (!user) {
      // No authenticated user reached this guard — should be impossible
      // when JwtAuthGuard runs first, but treat as forbidden defensively.
      throw new ForbiddenException('Authentication required');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
