import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body of `POST /admin/matches/:id/finish` and `POST /admin/matches/:id/recalculate`.
 *
 * Score bounds (0..99) match the prediction DTO so a single shared
 * client-side validator can cover both surfaces. The `Type(() => Number)`
 * coercion lets clients send numeric strings without tripping the
 * validator.
 *
 * `winnerTeamId` is only consulted when the match is in a knockout phase
 * (phase !== 'GROUPS') AND `scoreHome === scoreAway`. For every other
 * combination the service ignores it (the column is forced to null in
 * the persisted row). When the precondition triggers, the service rejects
 * the call unless `winnerTeamId` matches one of the two teams playing.
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

  @IsOptional()
  @IsString()
  winnerTeamId?: string;
}
