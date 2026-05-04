import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client.js';

/**
 * Shape of the value attached to `request.user` by `JwtAuthGuard` after a
 * successful access-token verification. Mirrors the JWT payload (`sub`,
 * `role`) but renames `sub` to `id` for ergonomics inside controllers.
 */
export interface AuthenticatedUser {
  id: string;
  role: Role;
}

/**
 * Resolves the currently-authenticated user from the request context.
 *
 * Usage:
 *   `@Get('me') me(@CurrentUser() user: AuthenticatedUser) { ... }`
 *
 * If no user is attached (e.g. on a `@Public()` route), returns `undefined`
 * so the handler can decide what to do.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    return req.user;
  },
);
