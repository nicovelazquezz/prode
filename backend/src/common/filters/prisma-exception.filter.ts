import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../../generated/prisma/client.js';

/**
 * Maps the most common `PrismaClientKnownRequestError` codes to HTTP
 * status codes so controllers don't have to know about Prisma internals.
 *
 *   P2002 — unique constraint violation       → 409 Conflict
 *   P2025 — record required for op not found  → 404 Not Found
 *
 * Other Prisma codes fall through to `GlobalExceptionFilter` (which
 * converts them to a sanitized 500). To stay scoped, this filter uses
 * `@Catch(Prisma.PrismaClientKnownRequestError)` so it only sees
 * Prisma exceptions — anything else (HttpException, plain Error) is
 * left for `GlobalExceptionFilter`.
 *
 * Note: `GlobalExceptionFilter` also has the same Prisma mapping inline
 * as a fallback in case this filter is ever bypassed (e.g. WebSocket
 * gateways with a different filter chain). Both must stay consistent.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

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
        // Let GlobalExceptionFilter handle the 500 path.
        throw exception;
    }
    this.logger.warn(`Prisma ${exception.code}: ${exception.message}`);
    res.status(status).json({
      statusCode: status,
      message,
      code: exception.code,
    });
  }
}
