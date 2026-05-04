import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { AuditService } from './audit.service.js';

/**
 * Global module so any feature module can inject `AuditService` (and
 * `AuditInterceptor` via Reflector) without having to import this module
 * explicitly.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
