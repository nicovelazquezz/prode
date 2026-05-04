import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * Body of `PUT /admin/matches/:id`.
 *
 * All fields are optional — the admin can patch any subset:
 *   - `kickoffAt`: triggers `predictionsLockAt` recompute (kickoff − 10 min)
 *     and an audit row with action `match.kickoff_updated`.
 *   - `homeTeamId` / `awayTeamId`: when both transition from null → not-null
 *     in the same call, the service also sets `predictionsOpenAt = now()`.
 *     Audit action `match.team_assigned`.
 *   - `venue` / `city` / `country`: cosmetic edits, no audit action change.
 *
 * Validation kept loose-but-typed: ids are strings (CUIDs) and dates are
 * ISO 8601. Stricter business checks (kickoff in the future, distinct teams)
 * live in the service.
 */
export class UpdateMatchDto {
  @IsOptional()
  @IsDateString()
  kickoffAt?: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  homeTeamId?: string;

  @IsOptional()
  @IsString()
  awayTeamId?: string;
}
