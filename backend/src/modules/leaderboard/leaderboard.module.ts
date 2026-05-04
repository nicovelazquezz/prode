import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { LeaderboardRefreshProcessor } from './leaderboard.processor.js';
import { LeaderboardRepository } from './leaderboard.repository.js';
import { LeaderboardService } from './leaderboard.service.js';
import { LeaderboardController } from './leaderboard.controller.js';

/**
 * Hosts the leaderboard worker (Phase 8 — `LeaderboardRefreshProcessor`)
 * and the public leaderboard endpoints (Phase 9 — repository + service +
 * controller).
 *
 * Marked `@Global` so `NotificationsModule` can inject the processor
 * without re-importing this module's sub-tree (mirrors how
 * `AdminAlertsModule` exposes its service).
 */
@Global()
@Module({
  imports: [PrismaModule],
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
