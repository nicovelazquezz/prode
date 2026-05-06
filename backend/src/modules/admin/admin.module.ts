import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminEntriesController } from './admin-entries.controller.js';
import { AdminPaymentsController } from './admin-payments.controller.js';

/**
 * Hosts admin-only endpoints that don't fit into a feature module. Today
 * the residents are:
 *   - POST /admin/users      — manual user creation (cash/transfer flow)
 *   - GET  /admin/entries    — listing of every entry in the system
 *   - GET  /admin/payments   — paginated payment listing for the panel
 *
 * Kept non-global so future additions can't accidentally widen the
 * surface — every route here goes through `RolesGuard` + `@Roles('ADMIN')`.
 *
 * No providers of its own: AuthService, PrismaService, AuditService are
 * already exposed via their `@Global()` parent modules.
 */
@Module({
  imports: [],
  controllers: [
    AdminUsersController,
    AdminEntriesController,
    AdminPaymentsController,
  ],
})
export class AdminModule {}
