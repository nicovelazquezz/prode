import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PrismaModule } from './shared/prisma/prisma.module.js';
import { AuditModule } from './modules/audit/audit.module.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AppController],
})
export class AppModule {}
