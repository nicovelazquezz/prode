import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminEntriesController } from './admin-entries.controller.js';
import { AdminPaymentsController } from './admin-payments.controller.js';

/**
 * Hosts admin-only endpoints que no encajan en un feature module. Hoy:
 *   - POST /admin/users               — creación manual (cash/transfer)
 *   - GET  /admin/entries             — listado de entries
 *   - GET  /admin/payments            — listado paginado de payments
 *   - POST /admin/payments/:id/approve — aprobación manual (delega a PaymentsService)
 *
 * Kept non-global so future additions can't accidentally widen the
 * surface — every route here goes through `RolesGuard` + `@Roles('ADMIN')`.
 *
 * Providers propios: ninguno. AuthService/PrismaService/AuditService
 * vienen de módulos `@Global()`. PaymentsService se importa explícitamente
 * via `PaymentsModule` para el endpoint de aprobación manual.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [
    AdminUsersController,
    AdminEntriesController,
    AdminPaymentsController,
  ],
})
export class AdminModule {}
