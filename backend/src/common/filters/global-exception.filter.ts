import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Last-resort exception filter.
 *
 *   - Forwards `HttpException`s as-is (their shape is already correct).
 *   - Maps known Prisma error codes (P2002 → 409, P2025 → 404) inline so
 *     controllers don't have to know about Prisma internals.
 *   - Converts everything else to a sanitized 500 response without
 *     leaking stack traces or DB internals.
 *
 * Sentry hooks are intentionally left as a TODO — Sentry wiring lands
 * in Phase 12. Until then `Logger.error` provides operator visibility
 * in dev/staging.
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
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

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
      return;
    }

    // 3) Anything else: log + sanitized 500.
    const err = exception as Error;
    this.logger.error(
      `Unhandled exception: ${err.message ?? exception}`,
      err.stack,
    );
    // TODO(phase-12): forward to Sentry here.
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
