import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body of `POST /predictions/special` and `PUT /predictions/special`.
 *
 * All fields are optional — the user can fill the special prediction in
 * stages (e.g. pick the champion now, the top scorer later). Cross-field
 * invariants (champion ≠ runnerUp ≠ third, totalGoals > 0, locked check)
 * live in the service so the validator stays declarative.
 *
 * `topScorerId` and `topScorerName` are mutually-cooperative: prefer the
 * id when the user picks an existing player, fall back to the free-form
 * name when the player isn't in our `Player` table yet.
 */
export class UpsertSpecialPredictionDto {
  @IsOptional()
  @IsString()
  championTeamId?: string;

  @IsOptional()
  @IsString()
  runnerUpTeamId?: string;

  @IsOptional()
  @IsString()
  thirdPlaceTeamId?: string;

  @IsOptional()
  @IsString()
  topScorerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  topScorerName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  totalGoals?: number;
}
