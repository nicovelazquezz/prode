import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body of `POST /predictions/match/:matchId` and `PUT /predictions/match/:matchId`.
 * Both verbs share the same payload because the underlying operation is an
 * UPSERT keyed on `(userId, matchId)` — POST is the natural verb for "first
 * write", PUT for idempotent overwrites, and exposing both keeps the public
 * API friendly to clients that prefer one over the other.
 *
 * Score bounds (0..99) match the service's defence-in-depth check; the
 * `Type(() => Number)` coercion lets clients send numeric strings without
 * tripping the validator.
 */
export class UpsertMatchPredictionDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  scoreHome!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  scoreAway!: number;
}
