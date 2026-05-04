import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { LeaguesService } from './leagues.service.js';
import { LeaguesController } from './leagues.controller.js';

/**
 * Hosts the mini-leagues feature surface (spec section 5.2 / Phase 10).
 * `AuditService` is provided globally by `AuditModule`, so this module
 * only wires its own service + controller.
 */
@Module({
  imports: [PrismaModule],
  controllers: [LeaguesController],
  providers: [LeaguesService],
  exports: [LeaguesService],
})
export class LeaguesModule {}
