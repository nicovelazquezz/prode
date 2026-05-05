import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';
import { Sentry, isSentryInitialized } from '../observability/sentry.js';

/**
 * Last-resort exception filter.
 *
 *   - Forwards `HttpException`s as-is (their shape is already correct).
 *   - Maps known Prisma error codes (P2002 → 409, P2025 → 404) inline so
 *     controllers don't have to know about Prisma internals.
 *   - Converts everything else to a sanitized 500 response without
 *     leaking stack traces or DB internals.
 *   - 5xx responses also fan out to Sentry (`captureException`) and the
 *     admin WhatsApp alerts pipeline so a backend regression is loud.
 *     4xx are intentionally only logged — the spec calls this out
 *     ("Sentry para 5xx, ignora 4xx esperados", section 9.3).
 *
 * Single filter (rather than a Prisma-specific filter + a global one)
 * so we don't fight the Nest filter chain — `@Catch()` filters that
 * re-throw don't fall through to the next one in the chain.
 */
interface PrismaErrorLike {
  code?: string;
  meta?: Record<string, unknown>;
  message?: string;
}

function isPrismaKnownError(err: unknown): err is PrismaErrorLike {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code);
}

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(
    // `@Optional()` so the filter can also be instantiated outside the
    // Nest DI graph (legacy unit tests, manual `new GlobalExceptionFilter()`).
    @Optional()
    private readonly adminAlerts?: AdminAlertsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // 1) HTTP exceptions: the response shape is already controlled by the
    //    framework (NestJS or our own throw). Pass through unchanged.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        res.status(status).json({ statusCode: status, message: body });
      } else if (body && typeof body === 'object') {
        res
          .status(status)
          .json({ statusCode: status, ...(body as Record<string, unknown>) });
      } else {
        res
          .status(status)
          .json({ statusCode: status, message: exception.message });
      }
      // 5xx HttpExceptions are still backend-side problems worth
      // Sentry/admin alerts (e.g. an explicit `throw new InternalServerErrorException`).
      if (status >= 500) {
        this.fanOutFiveXX(exception, status);
      }
      return;
    }

    // 2) Prisma known errors: surface as 409 / 404 / etc. We test
    //    structurally via `code` to avoid loading Prisma's runtime
    //    types from `@prisma/client/runtime/library`.
    if (isPrismaKnownError(exception)) {
      let status: number;
      let message: string;
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'Unique constraint violation';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'Database error';
      }
      this.logger.warn(
        `Prisma ${exception.code}: ${exception.message ?? message}`,
      );
      res.status(status).json({
        statusCode: status,
        message,
        code: exception.code,
      });
      if (status >= 500) {
        this.fanOutFiveXX(exception, status);
      }
      return;
    }

    // 3) Anything else: log + sanitized 500.
    const err = exception as Error;
    this.logger.error(
      `Unhandled exception: ${err.message ?? exception}`,
      err.stack,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
    this.fanOutFiveXX(exception, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Sends 5xx errors to Sentry (when configured) and to the admin
   * WhatsApp alert pipeline. Intentionally fire-and-forget — the
   * response has already been sent and we don't want a flaky alert
   * channel to delay the request thread.
   */
  private fanOutFiveXX(exception: unknown, status: number): void {
    if (isSentryInitialized()) {
      try {
        Sentry.captureException(exception);
      } catch (err) {
        this.logger.warn(
          `Sentry captureException failed: ${(err as Error).message}`,
        );
      }
    }
    if (this.adminAlerts) {
      const message =
        exception instanceof Error
          ? `${exception.name}: ${exception.message}`
          : String(exception);
      void this.adminAlerts
        .notify({
          type: 'BACKEND_ERROR',
          message: `HTTP ${status} en backend: ${message.slice(0, 400)}`,
        })
        .catch((err) =>
          this.logger.warn(
            `Admin alert dispatch failed: ${(err as Error).message}`,
          ),
        );
    }
  }
}
