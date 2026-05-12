import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Phase } from '../../../../generated/prisma/enums.js';

/**
 * Body of `POST /admin/matches`.
 *
 * Crea un partido nuevo. `matchNumber` se autoincrementa server-side
 * (max actual + 1) si no se pasa explícitamente — el admin no debería
 * preocuparse por el número de orden si está cargando partidos sueltos.
 *
 * `homeTeamLabel` / `awayTeamLabel` son strings: pueden ser fifaCodes
 * de 3 letras (`ARG`, `BRA`, etc.) en cuyo caso el service resuelve el
 * `homeTeamId` / `awayTeamId` desde la tabla `teams`, o pueden ser
 * placeholders ("Ganador R16-1", "2do Grupo C") para fases siguientes
 * donde los equipos aún no están definidos.
 *
 * `predictionsLockAt` se default-ea al kickoff − 10 minutos si no se
 * pasa (misma regla que `PUT /admin/matches/:id`). `predictionsOpenAt`
 * defaultea a null (predicciones siempre abiertas hasta el lock).
 */
export class CreateMatchDto {
  /**
   * Número de orden del partido. Único en toda la tabla. Opcional —
   * si no se pasa, el service usa `max(matchNumber) + 1` para no
   * obligar al admin a llevar la cuenta. Para el seed inicial del
   * Mundial se pasan los oficiales (1..104).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  matchNumber?: number;

  @IsEnum(Phase)
  phase!: keyof typeof Phase;

  /**
   * Solo aplica a `phase=GROUPS`. Strings tipo "A", "B"... "L". En las
   * otras fases queda null.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4)
  groupCode?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  homeTeamLabel!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  awayTeamLabel!: string;

  @IsDateString()
  kickoffAt!: string;

  @IsOptional()
  @IsDateString()
  predictionsLockAt?: string;

  @IsOptional()
  @IsDateString()
  predictionsOpenAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  venue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;
}
