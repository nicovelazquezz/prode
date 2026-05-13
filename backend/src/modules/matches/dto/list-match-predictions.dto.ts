import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OutcomeType } from '../../../../generated/prisma/enums.js';

/**
 * Valor sentinel del filtro `outcome` para predicciones aún no
 * evaluadas (la columna `outcomeType` es NULL en DB). Vive fuera del
 * enum Prisma porque solo tiene sentido en la capa de query — la
 * tabla nunca persiste el string "PENDING".
 */
export const PENDING_OUTCOME = 'PENDING' as const;

/**
 * Allow-list para el DTO. Usamos `@IsIn` (no `@IsEnum`) porque PENDING
 * no es miembro de `OutcomeType` y `@IsEnum` lo rechazaría.
 */
const OUTCOME_FILTER_VALUES = [
  ...Object.values(OutcomeType),
  PENDING_OUTCOME,
] as const;

export type OutcomeFilter = (typeof OUTCOME_FILTER_VALUES)[number];

/**
 * Sort options soportadas. Mapeo concreto a Prisma orderBy en
 * `MatchesService.listPredictions`.
 */
const SORT_OPTIONS = [
  'points_desc',
  'points_asc',
  'name_asc',
  'name_desc',
  'prediction',
] as const;

export type PredictionsSort = (typeof SORT_OPTIONS)[number];

/**
 * Query DTO para `GET /admin/matches/:id/predictions`.
 */
export class ListMatchPredictionsDto {
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
  @IsIn(OUTCOME_FILTER_VALUES, {
    message: `outcome must be one of: ${OUTCOME_FILTER_VALUES.join(', ')}`,
  })
  outcome?: OutcomeFilter;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(SORT_OPTIONS, {
    message: `sort must be one of: ${SORT_OPTIONS.join(', ')}`,
  })
  sort?: PredictionsSort;
}
