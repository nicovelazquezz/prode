import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { LeaderboardModule } from '../leaderboard/leaderboard.module.js';
import { EntriesController } from './entries.controller.js';
import { EntriesService } from './entries.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

/**
 * Wires the multi-prode entry surface. Pulls in:
 *   - PrismaModule for Entry / Payment / AppConfig reads & writes.
 *   - LeaderboardModule for LeaderboardRepository (per-entry rank).
 *   - The notifications queue (handle for OVER_CAP admin alerts in 5.2).
 *
 * AuthService + AuditService come from global modules, no explicit
 * import needed.
 */
@Module({
  imports: [
    PrismaModule,
    LeaderboardModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [EntriesController],
  providers: [EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
