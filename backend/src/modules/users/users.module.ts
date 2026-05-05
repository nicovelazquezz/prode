import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Marked @Global so AuthModule (and others) inject UsersService without
 * re-importing this module everywhere.
 *
 * The new public-profile endpoint lives in UsersController; it pulls
 * Prediction + Match rows directly via PrismaModule (no service layer
 * needed for one read), and uses the in-memory cache-manager store on
 * a 60s TTL — same approach as MatchesController.upcoming and
 * StatsController.public.
 */
@Global()
@Module({
  imports: [PrismaModule, CacheModule.register()],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
