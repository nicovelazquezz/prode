import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Pagination DTO shared by the global / phase / league listings.
 *
 * Bounds:
 *   - `page` ≥ 1 (no zero-based pagination here)
 *   - `pageSize` 1..200 — the upper bound mirrors `predictions/me` and
 *     is plenty for "load all groups" queries (200 > tournament size).
 */
export class LeaderboardPageDto {
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
}
