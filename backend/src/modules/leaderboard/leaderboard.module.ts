import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { LeaderboardRefreshProcessor } from './leaderboard.processor.js';
import { LeaderboardRepository } from './leaderboard.repository.js';

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
  providers: [LeaderboardRefreshProcessor, LeaderboardRepository],
  exports: [LeaderboardRefreshProcessor, LeaderboardRepository],
})
export class LeaderboardModule {}
