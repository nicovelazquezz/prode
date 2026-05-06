import { IsNotEmpty, IsString } from 'class-validator';

/**
 * `teamId` es obligatorio: el endpoint expone el roster por selección
 * para el picker de goleador, no la lista global de ~1600 jugadores.
 */
export class ListPlayersDto {
  @IsString()
  @IsNotEmpty()
  teamId!: string;
}
