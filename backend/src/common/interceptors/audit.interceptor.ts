import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import {
  AUDIT_KEY,
  AuditOptions,
} from '../decorators/audit.decorator.js';
import { AuditService } from '../../modules/audit/audit.service.js';

interface RequestLike {
  user?: { id?: string } | null;
  params?: Record<string, string>;
  body?: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Reads `@Audit` metadata from the handler, captures request context, and
 * inserts an `AuditLog` row **after** the handler has succeeded. The insert
 * is fire-and-forget — it never blocks the response and never logs on
 * failure (errors flow through the normal exception filter chain).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const opts = this.reflector.get<AuditOptions | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!opts) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<RequestLike>();
    const userId = req.user?.id ?? null;
    const entityId = opts.entityIdParam
      ? (req.params?.[opts.entityIdParam] ?? null)
      : null;
    const ipAddress = req.ip ?? req.socket?.remoteAddress;
    const userAgentRaw = req.headers?.['user-agent'];
    const userAgent = Array.isArray(userAgentRaw)
      ? userAgentRaw[0]
      : userAgentRaw;

    return next.handle().pipe(
      tap({
        next: (result) => {
          // Fire and forget — do not await.
          void this.audit
            .log({
              userId,
              action: opts.action,
              entity: opts.entity,
              entityId,
              changes:
                req.body && Object.keys(req.body as object).length > 0
                  ? (req.body as unknown)
                  : (result as unknown),
              ipAddress,
              userAgent,
            })
            .catch((err) =>
              this.logger.warn(
                `Audit interceptor swallowed error: ${(err as Error).message}`,
              ),
            );
        },
        // Note: error path intentionally left empty — failed handlers do not
        // produce an audit row.
      }),
    );
  }
}
