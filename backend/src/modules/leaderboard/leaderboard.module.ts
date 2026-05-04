import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { LeaderboardRefreshProcessor } from './leaderboard.processor.js';

/**
 * Hosts the leaderboard worker (Phase 8 — `LeaderboardRefreshProcessor`)
 * and, when Phase 9 lands, the public leaderboard endpoints.
 *
 * Marked `@Global` so `NotificationsModule` can inject the processor
 * without re-importing this module's sub-tree (mirrors how
 * `AdminAlertsModule` exposes its service).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [LeaderboardRefreshProcessor],
  exports: [LeaderboardRefreshProcessor],
})
export class LeaderboardModule {}
