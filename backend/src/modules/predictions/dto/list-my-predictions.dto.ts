import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Phase } from '../../../../generated/prisma/enums.js';

/**
 * Query for `GET /predictions/me`. Pagination + optional `phase` filter so
 * the frontend can ask for "my GROUPS predictions" without dragging the
 * full tournament back. Defaults are mirrored in the service.
 */
export class ListMyPredictionsDto {
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
}
