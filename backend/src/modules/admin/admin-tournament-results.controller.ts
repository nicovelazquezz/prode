import {
  BadRequestException,
  Body,
  Controller,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ScoringService } from '../scoring/scoring.service.js';
import { ScoreTournamentResultsDto } from './dto/score-tournament-results.dto.js';

/**
 * `PUT /admin/tournament-results` — admin carga los resultados oficiales
 * del Mundial (campeón, subcampeón, 3°, goleador, total de goles) y el
 * sistema puntúa todos los `SpecialPrediction` automáticamente.
 *
 * Diseño:
 *   - **Idempotente** (PUT): admin puede volver a llamar con valores
 *     corregidos y los puntos se recalculan sobreescribiendo. Útil si
 *     hubo un typo o un fallo de scrap.
 *   - **No requiere matches FINISHED**: los specials son una predicción
 *     agregada del torneo. Cuándo correr esto (post-final, post-3°, etc.)
 *     es decisión del admin.
 *   - **Validación de existencia** dentro del controller (no DTO): los
 *     teams deben existir, el goleador (player) también, y los 3 teams
 *     del podio deben ser distintos.
 *   - **Audit log** dentro del TX que escribe los puntos (atomicidad).
 *
 * Returns: stats útiles para el dashboard del admin —
 * cuántos `SpecialPrediction` se evaluaron, cuántos puntos en total se
 * distribuyeron y un breakdown por categoría (cuántos acertaron campeón,
 * cuántos subcampeón, etc.).
 */
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminTournamentResultsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: ScoringService,
  ) {}

  @Put('tournament-results')
  async scoreSpecials(
    @Body() dto: ScoreTournamentResultsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<{
    evaluated: number;
    totalPointsDistributed: number;
    breakdown: {
      champion: number;
      runnerUp: number;
      thirdPlace: number;
      topScorer: number;
      totalGoalsExact: number;
      totalGoalsClose: number;
    };
  }> {
    // ── Validación: 3 teams distintos en el podio ─────────────────────
    const podiumIds = [
      dto.championTeamId,
      dto.runnerUpTeamId,
      dto.thirdPlaceTeamId,
    ];
    if (new Set(podiumIds).size !== 3) {
      throw new BadRequestException(
        'Los 3 teams del podio deben ser distintos',
      );
    }

    // ── Validación: topScorerIds sin duplicados ───────────────────────
    const uniqueTopScorerIds = [...new Set(dto.topScorerIds)];
    if (uniqueTopScorerIds.length !== dto.topScorerIds.length) {
      throw new BadRequestException(
        'topScorerIds no puede contener jugadores repetidos',
      );
    }

    // ── Validación: existencia de teams + players ─────────────────────
    const [champion, runnerUp, thirdPlace, topScorers] = await Promise.all([
      this.prisma.team.findUnique({
        where: { id: dto.championTeamId },
        select: { id: true },
      }),
      this.prisma.team.findUnique({
        where: { id: dto.runnerUpTeamId },
        select: { id: true },
      }),
      this.prisma.team.findUnique({
        where: { id: dto.thirdPlaceTeamId },
        select: { id: true },
      }),
      this.prisma.player.findMany({
        where: { id: { in: uniqueTopScorerIds } },
        select: { id: true },
      }),
    ]);

    const missing: string[] = [];
    if (!champion) missing.push('championTeamId');
    if (!runnerUp) missing.push('runnerUpTeamId');
    if (!thirdPlace) missing.push('thirdPlaceTeamId');
    const foundIds = new Set(topScorers.map((p) => p.id));
    const missingTopScorers = uniqueTopScorerIds.filter(
      (id) => !foundIds.has(id),
    );
    if (missingTopScorers.length > 0) {
      missing.push(`topScorerIds[${missingTopScorers.join(', ')}]`);
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `Las siguientes referencias no existen en la BD: ${missing.join(', ')}`,
      );
    }

    return this.scoringService.scoreSpecialPredictions(
      {
        championTeamId: dto.championTeamId,
        runnerUpTeamId: dto.runnerUpTeamId,
        thirdPlaceTeamId: dto.thirdPlaceTeamId,
        topScorerIds: uniqueTopScorerIds,
        totalGoals: dto.totalGoals,
      },
      admin.id,
    );
  }
}
