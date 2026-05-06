import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Roster de la selección, ordenado por dorsal asc (nulls last) y luego
   * por nombre. Devuelve sólo los campos que consume el `PlayerSelectModal`
   * del frontend (`Player` en `lib/api/types.ts`).
   *
   * El índice `@@index([teamId])` en `players` cubre el filtro; el sort
   * sobre ~26 filas/equipo es trivial sin índice adicional.
   */
  async listByTeam(teamId: string) {
    return this.prisma.player.findMany({
      where: { teamId },
      orderBy: [
        { shirtNumber: { sort: 'asc', nulls: 'last' } },
        { fullName: 'asc' },
      ],
      select: {
        id: true,
        fullName: true,
        teamId: true,
        shirtNumber: true,
      },
    });
  }
}
