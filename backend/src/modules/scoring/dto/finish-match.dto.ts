import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body of `POST /admin/matches/:id/finish` and `POST /admin/matches/:id/recalculate`.
 *
 * Score bounds (0..99) match the prediction DTO so a single shared
 * client-side validator can cover both surfaces. The `Type(() => Number)`
 * coercion lets clients send numeric strings without tripping the
 * validator.
 */
export class FinishMatchDto {
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
