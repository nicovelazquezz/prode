import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module.js';
import { AuditService } from './audit.service.js';
import { AdminAuditController } from './admin-audit.controller.js';

/**
 * Global module so any feature module can inject `AuditService` (and
 * `AuditInterceptor` via Reflector) without having to import this module
 * explicitly.
 *
 * Hosts también `AdminAuditController` (`GET /admin/audit`) — el endpoint
 * vive acá y no en `AdminModule` porque su data es el `audit_logs` que
 * gestiona este módulo.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AdminAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
