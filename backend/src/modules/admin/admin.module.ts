import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminEntriesController } from './admin-entries.controller.js';
import { AdminPaymentsController } from './admin-payments.controller.js';
import { AdminMetricsController } from './admin-metrics.controller.js';

/**
 * Hosts admin-only endpoints que no encajan en un feature module. Hoy:
 *   - POST /admin/users                — creación manual (cash/transfer)
 *   - PATCH /admin/users/:id           — editar user (T3)
 *   - POST /admin/users/:id/reset-password (T4)
 *   - GET  /admin/entries              — listado de entries
 *   - GET  /admin/payments             — listado paginado de payments (T1)
 *   - POST /admin/payments/:id/approve — aprobación manual (T2)
 *   - GET  /admin/metrics              — métricas agregadas para dashboard (T10)
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
    AdminMetricsController,
  ],
})
export class AdminModule {}
