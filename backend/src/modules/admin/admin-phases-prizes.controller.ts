import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { LeaderboardRepository } from '../leaderboard/leaderboard.repository.js';
import { Phase } from '../../../generated/prisma/enums.js';

const PHASES: Phase[] = [
  Phase.GROUPS,
  Phase.ROUND_32,
  Phase.ROUND_16,
  Phase.QUARTERS,
  Phase.SEMIS,
  Phase.THIRD_PLACE,
  Phase.FINAL,
];

interface PhaseLeaderRow {
  userId: string;
  firstName: string;
  lastName: string;
  points: number;
}

interface PhaseSummary {
  phase: Phase;
  matchesTotal: number;
  matchesFinished: number;
  /** Verdadero si existe `PhaseWinner` para esta fase. */
  closed: boolean;
  /** Top 1 vivo (o registrado en PhaseWinner si la fase ya cerró). */
  proposedWinner: PhaseLeaderRow | null;
  /** Premio asociado al PhaseWinner (0 si la fase aún no cerró). */
  prizeAmount: number;
  /** Top 10 del ranking de la fase. */
  topTen: PhaseLeaderRow[];
}

interface PrizeRow {
  id: string;
  type: 'PHASE_WINNER';
  phase: Phase;
  amount: number;
  recipientUserId: string | null;
  recipientName: string | null;
  status: 'PENDING' | 'PAID';
  paidAt: string | null;
}

/**
 * Endpoints admin para visualizar fases y premios:
 *
 *   - `GET /admin/phases/summary` — overview de las 7 fases con su
 *     progreso (matches finished / total), si la fase cerró
 *     (PhaseWinner existe), el ganador propuesto y el top-10.
 *   - `GET /admin/prizes` — listado de PhaseWinner con info del user
 *     destinatario para el panel de "premios". El admin paga manualmente
 *     fuera del sistema (transferencia/efectivo) y mueve `prizeStatus`
 *     desde admin/prizes/[id] o desde admin/configuracion (no hay
 *     endpoint de "marcar pagado" en esta versión por decisión KISS).
 *
 * Ambos endpoints son read-only — solo `RolesGuard` + `@Roles('ADMIN')`,
 * sin throttling extra.
 */
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminPhasesPrizesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardRepository,
  ) {}

  @Get('phases/summary')
  async phasesSummary(): Promise<PhaseSummary[]> {
    // Una sola query agregada por (phase, status) para los conteos.
    const matchCounts = await this.prisma.match.groupBy({
      by: ['phase', 'status'],
      _count: { _all: true },
    });

    const winners = await this.prisma.phaseWinner.findMany({
      include: {
        entry: {
          select: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
    const winnersByPhase = new Map<Phase, (typeof winners)[number]>();
    for (const w of winners) winnersByPhase.set(w.phase, w);

    // El top-10 por fase lo resolvemos con el repository ya existente.
    // Es un query relativamente caro (LEFT JOIN sobre todas las entries
    // activas) pero con 7 fases x ~100 users el costo es trivial. Si en
    // el futuro hay 1000+ entries, vale cachearlo.
    const summaries: PhaseSummary[] = await Promise.all(
      PHASES.map(async (phase) => {
        const total = matchCounts
          .filter((m) => m.phase === phase)
          .reduce((sum, m) => sum + m._count._all, 0);
        const finished = matchCounts
          .filter((m) => m.phase === phase && m.status === 'FINISHED')
          .reduce((sum, m) => sum + m._count._all, 0);

        const winner = winnersByPhase.get(phase);
        const closed = !!winner;

        // Top 5 — número pequeño y digerible. El query devuelve TODAS las
        // entries activas (incluso con 0 puntos en la fase) ordenadas por
        // total_points DESC, así que limitamos acá. Cuando la fase no tiene
        // partidos finalizados, el frontend igual oculta la tabla en favor
        // de "Aún sin resultados".
        const { rows } = await this.leaderboard.getByPhase(phase, 1, 5);
        const topTen: PhaseLeaderRow[] = rows.map((r) => ({
          userId: r.user_id,
          firstName: r.first_name,
          lastName: r.last_name,
          points: r.total_points,
        }));

        // proposedWinner: si la fase cerró, devolvemos el winner real
        // (basado en PhaseWinner.entry.user). Si no, top-1 del ranking
        // vivo. Null si nadie tiene predicciones todavía.
        let proposedWinner: PhaseLeaderRow | null = null;
        if (closed && winner) {
          proposedWinner = {
            userId: winner.entry.user.id,
            firstName: winner.entry.user.firstName,
            lastName: winner.entry.user.lastName,
            points: winner.pointsEarned,
          };
        } else if (topTen.length > 0 && topTen[0]) {
          proposedWinner = topTen[0];
        }

        return {
          phase,
          matchesTotal: total,
          matchesFinished: finished,
          closed,
          proposedWinner,
          prizeAmount: winner?.prizeAmount ? Number(winner.prizeAmount) : 0,
          topTen,
        };
      }),
    );

    return summaries;
  }

  @Get('prizes')
  async prizes(): Promise<PrizeRow[]> {
    const winners = await this.prisma.phaseWinner.findMany({
      orderBy: { awardedAt: 'desc' },
      include: {
        entry: {
          select: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });

    return winners.map((w) => ({
      id: w.id,
      type: 'PHASE_WINNER' as const,
      phase: w.phase,
      amount: w.prizeAmount ? Number(w.prizeAmount) : 0,
      recipientUserId: w.entry.user.id,
      recipientName: `${w.entry.user.firstName} ${w.entry.user.lastName}`,
      status: w.prizeStatus === 'PAID' ? 'PAID' : 'PENDING',
      paidAt: w.prizePaidAt ? w.prizePaidAt.toISOString() : null,
    }));
  }
}
