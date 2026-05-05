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

/**
 * Thrown when a user tries to create or update a `Prediction` for a `Match`
 * whose `predictionsLockAt` has already passed (10 min before kickoff). Spec
 * section 8.7. The 400 status mirrors how class-validator failures surface,
 * so the frontend can route both through the same toast component.
 */
export class PredictionLockedException extends BadRequestException {
  constructor(
    message = 'Las predicciones para este partido ya están cerradas',
  ) {
    super({ statusCode: 400, code: 'PREDICTION_LOCKED', message });
  }
}

/**
 * Thrown when a user tries to upsert their `SpecialPrediction` after the
 * tournament-wide lock has fired (cron sets `lockedAt = now()` once the
 * inaugural match's `predictionsLockAt` is reached). Spec section 5.3.
 */
export class SpecialPredictionLockedException extends BadRequestException {
  constructor(
    message = 'Las predicciones especiales ya están cerradas',
  ) {
    super({ statusCode: 400, code: 'SPECIAL_PREDICTION_LOCKED', message });
  }
}

/**
 * Thrown when an admin tries to `finish` a match that's already FINISHED.
 * The recalculate endpoint should be used instead. Spec section 6.3.
 */
export class MatchAlreadyFinishedException extends BadRequestException {
  constructor(message = 'Match has already been finished') {
    super({ statusCode: 400, code: 'MATCH_ALREADY_FINISHED', message });
  }
}

/**
 * Thrown when an admin tries to `recalculate` a match that's not yet
 * FINISHED. The finish endpoint should be used instead. Spec section 6.3.
 */
export class MatchNotFinishedException extends BadRequestException {
  constructor(message = 'Match has not been finished yet') {
    super({ statusCode: 400, code: 'MATCH_NOT_FINISHED', message });
  }
}

/**
 * Thrown when an admin tries to mutate any match in a phase whose
 * PhaseWinner row already carries `prizeStatus = 'PAID'`. The phase is
 * effectively closed/immutable from that point on. Spec section 6.3.
 *
 * 409 Conflict (rather than 400) because the request shape is valid;
 * it conflicts with state the server has already committed.
 */
export class PhaseAlreadyPaidException extends ConflictException {
  constructor(
    message = 'Phase prize already paid — match cannot be modified',
  ) {
    super({ statusCode: 409, code: 'PHASE_ALREADY_PAID', message });
  }
}

/**
 * Thrown when a user tries to join a mini-league whose member count has
 * already reached `maxMembers`. Spec section 5.2 / Phase 10. 409
 * Conflict because the request is well-formed; the server-side state
 * just doesn't have room.
 */
export class LeagueFullException extends ConflictException {
  constructor(message = 'League has reached its member cap') {
    super({ statusCode: 409, code: 'LEAGUE_FULL', message });
  }
}

/**
 * Thrown when a user tries to join a league they're already a member
 * of. Surfaces the same 409 shape so the frontend can route both
 * "league full" and "already in" through a single error handler.
 */
export class AlreadyLeagueMemberException extends ConflictException {
  constructor(message = 'Already a member of this league') {
    super({ statusCode: 409, code: 'ALREADY_LEAGUE_MEMBER', message });
  }
}

/**
 * Thrown when a logged-in user tries to add another prode but already
 * reached the configured `max_entries_per_user` cap. Spec multi-prode §3.2.
 * 409 Conflict — request is well-formed, server-side state has no room.
 * Body carries `current` and `cap` so the UI can render an exact message.
 */
export class EntryCapReachedException extends ConflictException {
  constructor(current: number, cap: number) {
    super({
      statusCode: 409,
      code: 'ENTRY_CAP_REACHED',
      message: `Llegaste al máximo de ${cap} entradas`,
      current,
      cap,
    });
  }
}
