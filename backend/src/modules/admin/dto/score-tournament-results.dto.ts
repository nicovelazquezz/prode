import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Body de `PUT /admin/tournament-results`. Resultados oficiales del
 * Mundial 2026 que el admin carga al final del torneo para puntuar
 * todos los `SpecialPrediction`.
 *
 * `topScorerIds` es array para soportar empate de goleador: si dos
 * (o más) jugadores cierran el torneo con la misma cantidad de goles,
 * el reglamento del prode los considera a todos válidos. Cualquier
 * usuario que haya pickeado uno de ellos cobra los puntos del topScorer.
 *
 * Validaciones livianas a nivel DTO — la validación de existencia
 * (team / player) corre en el controller con queries a la BD para
 * dar 400 con un mensaje claro si el id no existe.
 */
export class ScoreTournamentResultsDto {
  @IsString()
  @IsNotEmpty({ message: 'championTeamId requerido' })
  championTeamId!: string;

  @IsString()
  @IsNotEmpty({ message: 'runnerUpTeamId requerido' })
  runnerUpTeamId!: string;

  @IsString()
  @IsNotEmpty({ message: 'thirdPlaceTeamId requerido' })
  thirdPlaceTeamId!: string;

  @IsArray({ message: 'topScorerIds debe ser un array' })
  @ArrayMinSize(1, { message: 'topScorerIds requiere al menos 1 jugador' })
  @IsString({ each: true, message: 'topScorerIds debe contener strings' })
  topScorerIds!: string[];

  @IsInt({ message: 'totalGoals debe ser un entero' })
  @Min(0, { message: 'totalGoals no puede ser negativo' })
  @Max(500, { message: 'totalGoals demasiado alto (máx 500)' })
  totalGoals!: number;
}
