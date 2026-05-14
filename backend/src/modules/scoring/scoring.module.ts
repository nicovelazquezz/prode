import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { ScoringConfigService } from './scoring-config.service.js';
import { ScoringService } from './scoring.service.js';
import { PhaseService } from './phase.service.js';
import { MatchProgressionService } from './match-progression.service.js';
import { GroupStandingsService } from './group-standings.service.js';
import { ScoringController } from './scoring.controller.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

/**
 * Scoring module. Hosts the pure outcome classifier helpers, the cached
 * config service, the scoring service (finish + recalculate), and the
 * phase-progression orchestrator (stub in 8.3, fleshed out in 8.7).
 *
 * Cache: dedicated `CacheModule.register()` instance keeps the
 * `ScoringConfigService` cache local to this module. Spec section 7.1
 * marks Redis as the eventual production store; the swap is a one-line
 * change here.
 *
 * BullMQ: registers the `notifications` queue locally so `ScoringService`
 * can enqueue `leaderboard.refresh` and `match-result` jobs. The root
 * BullMQ connection comes from `BullMqModule` (global) — registerQueue
 * here just declares producer access from this module.
 */
@Module({
  imports: [
    PrismaModule,
    CacheModule.register(),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [ScoringController],
  providers: [
    ScoringConfigService,
    ScoringService,
    PhaseService,
    MatchProgressionService,
    GroupStandingsService,
  ],
  exports: [
    ScoringConfigService,
    ScoringService,
    PhaseService,
    MatchProgressionService,
    GroupStandingsService,
  ],
})
export class ScoringModule {}
