import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body de `POST /admin/fases/builder/:phase`.
 *
 * Una fila por cada match de la fase (16 R32, 8 R16, 4 QF, 2 SF, 2 FINAL
 * [#103 THIRD_PLACE + #104 FINAL]). `homeTeamId` / `awayTeamId` son
 * opcionales y aceptan `null` para limpiar la asignación.
 *
 * Validaciones livianas a nivel DTO — la lógica de uniqueness de equipos
 * y la verificación de pertenencia del matchId a la fase corre en el
 * handler con queries a la BD.
 */
export class BuilderApplyMatchDto {
  @IsString({ message: 'matchId debe ser string' })
  matchId!: string;

  @IsOptional()
  @IsString({ message: 'homeTeamId debe ser string o null' })
  homeTeamId?: string | null;

  @IsOptional()
  @IsString({ message: 'awayTeamId debe ser string o null' })
  awayTeamId?: string | null;
}

export class BuilderApplyDto {
  @IsArray({ message: 'matches debe ser un array' })
  @ArrayMinSize(1, { message: 'matches requiere al menos 1 elemento' })
  @ValidateNested({ each: true })
  @Type(() => BuilderApplyMatchDto)
  matches!: BuilderApplyMatchDto[];
}
