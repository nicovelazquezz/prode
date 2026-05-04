import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for `GET /leaderboard/me/around`. `n` is the half-window
 * — the response carries up to `2n + 1` rows (n above, self, n below).
 *
 * Upper bound 50 is generous: most UIs want 5-10 rows of context. Past
 * 50 the caller should be hitting the paged global endpoint instead.
 */
export class LeaderboardAroundDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  n?: number;
}
