import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MatchStatus, Phase } from '../../../../generated/prisma/enums.js';

/**
 * Query parameters for `GET /matches`. Pagination plus optional filters by
 * `phase`, `status`, and a kickoff window (`from`/`to`).
 *
 * `class-transformer` plus `ValidationPipe({ transform: true })` (the global
 * pipe) coerce numeric strings into numbers; we still bound them defensively.
 */
export class ListMatchesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @IsOptional()
  @IsEnum(Phase)
  phase?: Phase;

  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;

  /** Inclusive lower bound on `kickoffAt` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Exclusive upper bound on `kickoffAt` (ISO 8601). */
  @IsOptional()
  @IsDateString()
  to?: string;
}
