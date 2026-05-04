import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { LeaderboardRefreshProcessor } from './leaderboard.processor.js';
import { LeaderboardRepository } from './leaderboard.repository.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LeaderboardController } from './leaderboard.controller.js';
import { LeaderboardAdminModule } from './leaderboard-admin.module.js';

/**
 * Hosts the leaderboard worker (Phase 8 — `LeaderboardRefreshProcessor`)
 * and the public leaderboard endpoints (Phase 9 — repository + service
 * + public controller). The admin manual-refresh endpoint lives in
 * {@link LeaderboardAdminModule} so any future admin-only wiring
 * (extra providers, queue registrations, etc.) stays scoped and does
 * NOT leak through this `@Global` boundary into the rest of the app.
 *
 * Marked `@Global` so `NotificationsModule` can inject the processor
 * without re-importing this module's sub-tree (mirrors how
 * `AdminAlertsModule` exposes its service).
 */
@Global()
@Module({
  imports: [PrismaModule, LeaderboardAdminModule],
  controllers: [LeaderboardController],
  providers: [
    LeaderboardRefreshProcessor,
    LeaderboardRepository,
    LeaderboardService,
  ],
  exports: [
    LeaderboardRefreshProcessor,
    LeaderboardRepository,
    LeaderboardService,
  ],
})
export class LeaderboardModule {}
