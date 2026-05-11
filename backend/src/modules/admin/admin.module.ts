import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { LeaderboardModule } from '../leaderboard/leaderboard.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminEntriesController } from './admin-entries.controller.js';
import { AdminPaymentsController } from './admin-payments.controller.js';
import { AdminMetricsController } from './admin-metrics.controller.js';
import { AdminConfigController } from './admin-config.controller.js';
import { AdminTournamentResultsController } from './admin-tournament-results.controller.js';
import { AdminPhasesPrizesController } from './admin-phases-prizes.controller.js';
import { AdminNotificationsController } from './admin-notifications.controller.js';

/**
 * Hosts admin-only endpoints que no encajan en un feature module. Hoy:
 *   - POST /admin/users                  — creación manual (cash/transfer)
 *   - PATCH /admin/users/:id             — editar user (T3)
 *   - POST /admin/users/:id/reset-password (T4)
 *   - GET  /admin/entries                — listado de entries
 *   - GET  /admin/payments               — listado paginado de payments (T1)
 *   - POST /admin/payments/:id/approve   — aprobación manual (T2)
 *   - GET  /admin/metrics                — métricas agregadas para dashboard (T10)
 *   - GET/PUT /admin/config              — AppConfig CRUD (T11)
 *   - GET/PUT /admin/scoring-rules       — ScoringRule CRUD (T11)
 *   - GET/PUT /admin/phase-multipliers   — PhaseMultiplier CRUD (T11)
 *   - GET/PUT /admin/special-prize-rules — SpecialPrizeRule CRUD (T11)
 *
 * Kept non-global so future additions can't accidentally widen the
 * surface — every route here goes through `RolesGuard` + `@Roles('ADMIN')`.
 *
 * Providers propios: ninguno. AuthService/PrismaService/AuditService
 * vienen de módulos `@Global()`. PaymentsService se importa explícitamente
 * via `PaymentsModule` para el endpoint de aprobación manual.
 */
@Module({
  imports: [
    PaymentsModule,
    ScoringModule,
    LeaderboardModule,
    NotificationsModule,
  ],
  controllers: [
    AdminUsersController,
    AdminEntriesController,
    AdminPaymentsController,
    AdminMetricsController,
    AdminConfigController,
    AdminTournamentResultsController,
    AdminPhasesPrizesController,
    AdminNotificationsController,
  ],
})
export class AdminModule {}
