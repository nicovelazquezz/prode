import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { PlayersController } from './players.controller.js';
import { PlayersService } from './players.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
