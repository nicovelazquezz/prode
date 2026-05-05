import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller.js';

/**
 * Hosts admin-only endpoints that don't fit into a feature module. Today
 * the only resident is `POST /admin/users` (manual user creation for
 * cash/transfer payments). Kept non-global so future additions can't
 * accidentally widen the surface — every route here goes through
 * `RolesGuard` + `@Roles('ADMIN')` at the controller level.
 *
 * No providers of its own: AuthService, PrismaService, AuditService are
 * already exposed via their `@Global()` parent modules.
 */
@Module({
  imports: [],
  controllers: [AdminUsersController],
})
export class AdminModule {}
