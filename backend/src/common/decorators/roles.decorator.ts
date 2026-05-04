import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client.js';

/**
 * Metadata key consumed by `RolesGuard` to look up which roles are allowed
 * to access a handler.
 */
export const ROLES_KEY = 'roles';

/**
 * Restricts a handler to users whose `role` matches one of the provided
 * roles. Must be combined with `JwtAuthGuard` so that `request.user` has
 * already been populated.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
