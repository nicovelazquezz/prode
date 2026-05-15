import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  GroupStandingsService,
  type GroupStanding,
} from '../scoring/group-standings.service.js';
import { Phase, type MatchStatus } from '../../../generated/prisma/enums.js';
import { BuilderApplyDto } from './dto/builder-apply.dto.js';

/**
 * GET /admin/fases/builder/:phase — devuelve los matches de la fase pedida
 * más la referencia que el frontend usa para armar los cruces.
 *
 * Solo 5 valores válidos de `:phase`: ROUND_32, ROUND_16, QUARTERS, SEMIS,
 * FINAL. THIRD_PLACE NO es opción del param — sus dos matches (#103 3er
 * puesto y #104 final) viven dentro del builder de FINAL, distinguidos
 * por `matchPhase`. GROUPS tampoco aplica (no se "arman cruces" para la
 * fase de grupos).
 *
 * Reference shape:
 *   - `phase === 'ROUND_32'`: `{ type: 'GROUPS', standings }` con las 12
 *     tablas (A..L) computadas on-demand desde `GroupStandingsService`.
 *   - resto: `{ type: 'PREVIOUS_ROUND', previousPhase, matches }` listando
 *     los matches de la fase anterior con winner/loser ya computados (a
 *     partir de scores cuando no son iguales, o de `winnerTeamId` cuando
 *     hay empate por penales).
 */

type BuilderPhase = 'ROUND_32' | 'ROUND_16' | 'QUARTERS' | 'SEMIS' | 'FINAL';

const VALID_PHASES: BuilderPhase[] = [
  'ROUND_32',
  'ROUND_16',
  'QUARTERS',
  'SEMIS',
  'FINAL',
];

const PREVIOUS_PHASE_MAP: Record<Exclude<BuilderPhase, 'ROUND_32'>, Phase> = {
  ROUND_16: Phase.ROUND_32,
  QUARTERS: Phase.ROUND_16,
  SEMIS: Phase.QUARTERS,
  FINAL: Phase.SEMIS,
};

interface BuilderMatch {
  matchId: string;
  matchNumber: number;
  matchPhase: Phase;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamLabel: string | null;
  awayTeamLabel: string | null;
  kickoffAt: string;
  venue: string | null;
}

interface TeamRef {
  id: string;
  name: string;
  flagUrl: string;
}

interface PreviousRoundMatchRef {
  matchNumber: number;
  homeTeam: TeamRef | null;
  awayTeam: TeamRef | null;
  scoreHome: number | null;
  scoreAway: number | null;
  winner: TeamRef | null;
  loser: TeamRef | null;
  status: MatchStatus;
}

type Reference =
  | {
      type: 'GROUPS';
      standings: Record<string, GroupStanding[]>;
    }
  | {
      type: 'PREVIOUS_ROUND';
      previousPhase: Phase;
      matches: PreviousRoundMatchRef[];
    };

interface BuilderState {
  phase: BuilderPhase;
  matches: BuilderMatch[];
  reference: Reference;
}

@Controller('admin/fases/builder')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminFasesBuilderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standings: GroupStandingsService,
  ) {}

  @Get(':phase')
  async getBuilder(@Param('phase') phase: string): Promise<BuilderState> {
    if (!VALID_PHASES.includes(phase as BuilderPhase)) {
      throw new BadRequestException(
        phase === 'THIRD_PLACE'
          ? 'THIRD_PLACE se administra junto con FINAL'
          : `phase ${phase} no es válida para el builder`,
      );
    }

    const builderPhase = phase as BuilderPhase;

    // Para FINAL incluimos AMBOS matches (#103 THIRD_PLACE y #104 FINAL).
    // Para el resto, sólo la fase exacta.
    const matchPhases: Phase[] =
      builderPhase === 'FINAL'
        ? [Phase.THIRD_PLACE, Phase.FINAL]
        : [builderPhase as Phase];

    const matches = await this.prisma.match.findMany({
      where: { phase: { in: matchPhases } },
      orderBy: { matchNumber: 'asc' },
    });

    let reference: Reference;
    if (builderPhase === 'ROUND_32') {
      reference = {
        type: 'GROUPS',
        standings: await this.standings.getAllGroupStandings(),
      };
    } else {
      const previousPhase = PREVIOUS_PHASE_MAP[builderPhase];
      const prevMatches = await this.prisma.match.findMany({
        where: { phase: previousPhase },
        include: { homeTeam: true, awayTeam: true, winnerTeam: true },
        orderBy: { matchNumber: 'asc' },
      });
      reference = {
        type: 'PREVIOUS_ROUND',
        previousPhase,
        matches: prevMatches.map(toPrevRef),
      };
    }

    return {
      phase: builderPhase,
      matches: matches.map(
        (m): BuilderMatch => ({
          matchId: m.id,
          matchNumber: m.matchNumber,
          matchPhase: m.phase,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          homeTeamLabel: m.homeTeamLabel,
          awayTeamLabel: m.awayTeamLabel,
          kickoffAt: m.kickoffAt.toISOString(),
          venue: m.venue,
        }),
      ),
      reference,
    };
  }

  /**
   * POST /admin/fases/builder/:phase — aplica las asignaciones de equipos
   * para los matches de la fase. Body: `{ matches: [{matchId, homeTeamId?,
   * awayTeamId?}] }`.
   *
   * Reglas:
   *   - Cada equipo puede aparecer SÓLO una vez dentro del request
   *     (cross-match uniqueness, excluyendo nulls).
   *   - Dentro de un mismo match, home !== away (cuando ambos son
   *     no-null).
   *   - El matchId debe pertenecer a la fase (para FINAL aceptamos los
   *     dos matches de THIRD_PLACE + FINAL).
   *   - Si una asignación cambia un match de (null, null) a (X, Y) con
   *     ambos seteados, se setea `predictionsOpenAt = now()` (abre
   *     pronósticos). Si ya estaba seteado, NO se resetea.
   *   - El auditLog se escribe sólo cuando hay diffs reales.
   *   - Idempotente: re-posting del mismo body devuelve
   *     `matchesUpdated: 0` y NO escribe audit log.
   */
  @Post(':phase')
  async applyBuilder(
    @Param('phase') phase: string,
    @Body() dto: BuilderApplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ok: true; matchesUpdated: number }> {
    if (!VALID_PHASES.includes(phase as BuilderPhase)) {
      throw new BadRequestException(
        phase === 'THIRD_PLACE'
          ? 'THIRD_PLACE se administra junto con FINAL'
          : `phase ${phase} no es válida para el builder`,
      );
    }

    const builderPhase = phase as BuilderPhase;

    // 1) Validaciones in-memory: home !== away por match, y uniqueness
    //    cross-match (excluyendo null).
    const seen = new Set<string>();
    for (const m of dto.matches) {
      const home = m.homeTeamId ?? null;
      const away = m.awayTeamId ?? null;
      if (home !== null && away !== null && home === away) {
        throw new BadRequestException(
          `Match ${m.matchId}: homeTeamId no puede ser igual a awayTeamId`,
        );
      }
      for (const tid of [home, away]) {
        if (tid === null) continue;
        if (seen.has(tid)) {
          throw new BadRequestException(
            `Equipo ${tid} aparece en más de un cruce`,
          );
        }
        seen.add(tid);
      }
    }

    // 2) Verificar que los matchIds pertenecen a la fase. Para FINAL
    //    aceptamos THIRD_PLACE + FINAL.
    const matchPhases: Phase[] =
      builderPhase === 'FINAL'
        ? [Phase.THIRD_PLACE, Phase.FINAL]
        : [builderPhase as Phase];
    const phaseMatches = await this.prisma.match.findMany({
      where: { phase: { in: matchPhases } },
      select: { id: true },
    });
    const validMatchIds = new Set(phaseMatches.map((m) => m.id));
    for (const m of dto.matches) {
      if (!validMatchIds.has(m.matchId)) {
        throw new BadRequestException(
          `Match ${m.matchId} no pertenece a la fase ${phase}`,
        );
      }
    }

    // 3) Aplicar dentro de una sola transacción. Calcular diffs y
    //    decidir predictionsOpenAt por match.
    const now = new Date();
    let matchesUpdated = 0;
    const diffs: Array<{
      matchId: string;
      before: { homeTeamId: string | null; awayTeamId: string | null };
      after: { homeTeamId: string | null; awayTeamId: string | null };
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const m of dto.matches) {
        const current = await tx.match.findUniqueOrThrow({
          where: { id: m.matchId },
          select: {
            homeTeamId: true,
            awayTeamId: true,
            predictionsOpenAt: true,
          },
        });
        const nextHome = m.homeTeamId ?? null;
        const nextAway = m.awayTeamId ?? null;
        if (
          current.homeTeamId === nextHome &&
          current.awayTeamId === nextAway
        ) {
          continue;
        }
        // Abrir pronósticos sólo si antes estaba sin abrir y ahora
        // ambos teams están definidos.
        const shouldOpenPredictions =
          current.predictionsOpenAt === null &&
          nextHome !== null &&
          nextAway !== null;
        await tx.match.update({
          where: { id: m.matchId },
          data: {
            homeTeamId: nextHome,
            awayTeamId: nextAway,
            ...(shouldOpenPredictions ? { predictionsOpenAt: now } : {}),
          },
        });
        diffs.push({
          matchId: m.matchId,
          before: {
            homeTeamId: current.homeTeamId,
            awayTeamId: current.awayTeamId,
          },
          after: { homeTeamId: nextHome, awayTeamId: nextAway },
        });
        matchesUpdated++;
      }
      if (matchesUpdated > 0) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'phase.builder.applied',
            entity: 'phase',
            entityId: builderPhase,
            changes: { matches: diffs },
          },
        });
      }
    });

    return { ok: true, matchesUpdated };
  }
}

/**
 * Convierte un Match (con homeTeam/awayTeam/winnerTeam incluidos) a la
 * shape de referencia que el frontend del builder consume.
 *
 * Reglas de winner/loser:
 *   - Si los teams no están seteados o el match no terminó (no hay scores)
 *     → winner=loser=null.
 *   - Si scoreHome !== scoreAway → winner es el del score mayor, loser el
 *     del menor. winnerTeamId se ignora porque los scores ya definen.
 *   - Si scoreHome === scoreAway → necesita winnerTeamId (empate por
 *     penales/decisión). Si está seteado, winner = ese team y loser es el
 *     otro. Si NO está, devolvemos null en ambos (estado inconsistente que
 *     el admin debe corregir desde "Finalizar partido").
 */
function toPrevRef(
  m: {
    matchNumber: number;
    homeTeam: { id: string; name: string; flagUrl: string } | null;
    awayTeam: { id: string; name: string; flagUrl: string } | null;
    winnerTeam: { id: string; name: string; flagUrl: string } | null;
    scoreHome: number | null;
    scoreAway: number | null;
    status: MatchStatus;
  },
): PreviousRoundMatchRef {
  const home = m.homeTeam ? toTeamRef(m.homeTeam) : null;
  const away = m.awayTeam ? toTeamRef(m.awayTeam) : null;

  let winner: TeamRef | null = null;
  let loser: TeamRef | null = null;

  if (
    home &&
    away &&
    m.scoreHome !== null &&
    m.scoreAway !== null
  ) {
    if (m.scoreHome > m.scoreAway) {
      winner = home;
      loser = away;
    } else if (m.scoreHome < m.scoreAway) {
      winner = away;
      loser = home;
    } else if (m.winnerTeam) {
      // Empate por penales: winnerTeamId decide.
      const w = toTeamRef(m.winnerTeam);
      winner = w;
      loser = w.id === home.id ? away : home;
    }
  }

  return {
    matchNumber: m.matchNumber,
    homeTeam: home,
    awayTeam: away,
    scoreHome: m.scoreHome,
    scoreAway: m.scoreAway,
    winner,
    loser,
    status: m.status,
  };
}

function toTeamRef(t: { id: string; name: string; flagUrl: string }): TeamRef {
  return { id: t.id, name: t.name, flagUrl: t.flagUrl };
}
