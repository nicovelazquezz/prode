import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

/**
 * Options consumed by {@link AuditInterceptor}.
 *
 * - `action`: dotted action key (e.g. `prediction.created`).
 * - `entity`: domain entity name (e.g. `prediction`, `match`).
 * - `entityIdParam`: optional name of the route param that carries the id of
 *   the entity being acted on (e.g. `matchId`). When provided, the
 *   interceptor reads `request.params[entityIdParam]`.
 */
export interface AuditOptions {
  action: string;
  entity: string;
  entityIdParam?: string;
}

/**
 * Marks a controller handler so it gets an `AuditLog` row inserted on
 * success. Use on admin actions, auth events, predictions, etc.
 */
export const Audit = (opts: AuditOptions) => SetMetadata(AUDIT_KEY, opts);
