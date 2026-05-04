import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

export interface AuditLogInput {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  changes?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists one audit log entry. Designed to be called fire-and-forget from
   * an interceptor; failures are swallowed (with warn) so they cannot leak
   * back into the user-facing response.
   */
  async log(args: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: args.userId ?? null,
          action: args.action,
          entity: args.entity,
          entityId: args.entityId ?? null,
          changes:
            args.changes === undefined
              ? undefined
              : (args.changes as Parameters<
                  typeof this.prisma.auditLog.create
                >[0]['data']['changes']),
          ipAddress: args.ipAddress,
          userAgent: args.userAgent,
        },
      });
    } catch (err) {
      // Never let audit logging break the request flow.
      this.logger.warn(
        `Failed to write audit log (action=${args.action}, entity=${args.entity}): ${
          (err as Error).message
        }`,
      );
    }
  }
}
