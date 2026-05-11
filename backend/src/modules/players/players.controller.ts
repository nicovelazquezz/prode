import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { ListPlayersDto } from './dto/list-players.dto.js';
import { PlayersService } from './players.service.js';

/**
 * Lookup público para el picker de goleador (predicciones especiales).
 * `@Public()` para que el modal pueda cargar el roster sin requerir
 * que el usuario tenga ya una predicción especial creada.
 */
@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Public()
  @Get()
  async list(@Query() query: ListPlayersDto) {
    return this.playersService.listByTeam(query.teamId);
  }
}
