import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { LeaguesService } from './leagues.service.js';
import { LeaguesController } from './leagues.controller.js';

/**
 * Hosts the mini-leagues feature surface (spec section 5.2 / Phase 10).
 *
 * `AuditService` is provided globally by `AuditModule`, and
 * `LeaderboardService` is provided globally by `LeaderboardModule`
 * (Phase 9), so this module only needs to wire its own service +
 * controller — both globals are available in the controller's DI graph
 * without explicit imports.
 */
@Module({
  imports: [PrismaModule],
  controllers: [LeaguesController],
  providers: [LeaguesService],
  exports: [LeaguesService],
})
export class LeaguesModule {}
