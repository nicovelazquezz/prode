import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body of `POST /leagues`. Mirrors spec section 5.2 — `name` is the only
 * required field; `inviteCode` is generated server-side and `ownerId` is
 * derived from the JWT, so neither belongs in the public payload.
 *
 * Bounds rationale:
 *   - `name` 3..50: short enough to render in cards, long enough for
 *     "Liga del Grupo de WhatsApp del trabajo".
 *   - `description` ≤ 200: one sentence; longer copy belongs on the user's
 *     profile, not on every membership card.
 *   - `maxMembers` 2..200: 2 because a one-person league is meaningless,
 *     200 mirrors the tournament-wide active-user upper bound from the
 *     leaderboard pagination.
 */
export class CreateLeagueDto {
  @IsString()
  @Length(3, 50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(200)
  maxMembers?: number;

  /**
   * Multi-prode: which of the caller's entries joins the new league as
   * the owner's first member. Optional — when omitted, the service
   * picks the caller's primary (lowest-position) ACTIVE entry. The
   * frontend sends it explicitly when the user has > 1 entry.
   */
  @IsOptional()
  @IsString()
  entryId?: string;
}
