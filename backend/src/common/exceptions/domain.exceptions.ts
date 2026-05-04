import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

/**
 * Centralised domain exception catalogue, mirrors spec section 8.7.
 * Plain HttpException subclasses keep the GlobalExceptionFilter happy
 * and surface a stable `code` field clients can switch on.
 */

export class InvalidCompletionTokenException extends NotFoundException {
  constructor(message = 'Invalid or expired completion token') {
    super({ statusCode: 404, code: 'INVALID_COMPLETION_TOKEN', message });
  }
}

export class PaymentNotApprovedException extends BadRequestException {
  constructor(message = 'Payment is not approved') {
    super({ statusCode: 400, code: 'PAYMENT_NOT_APPROVED', message });
  }
}

export class CompletionTokenExpiredException extends HttpException {
  constructor(message = 'Completion token has expired') {
    // 410 Gone — the resource (the magic link) once existed but is gone.
    super({ statusCode: 410, code: 'COMPLETION_TOKEN_EXPIRED', message }, HttpStatus.GONE);
  }
}

export class CompletionAlreadyUsedException extends HttpException {
  constructor(message = 'Registration already completed for this payment') {
    super({ statusCode: 410, code: 'COMPLETION_ALREADY_USED', message }, HttpStatus.GONE);
  }
}

export class DniAlreadyExistsException extends ConflictException {
  constructor(message = 'DNI already registered') {
    super({ statusCode: 409, code: 'DNI_ALREADY_EXISTS', message });
  }
}

export class WhatsappAlreadyExistsException extends ConflictException {
  constructor(message = 'WhatsApp number already registered') {
    super({ statusCode: 409, code: 'WHATSAPP_ALREADY_EXISTS', message });
  }
}
