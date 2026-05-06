import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

const SPARKLINE_DAYS = 14;

/**
 * Métricas agregadas para el dashboard `/admin`. Una sola query a este
 * endpoint reemplaza un puñado de calls dispersas — el frontend lo usa
 * para popular las 4 cards superiores + 2 sparklines.
 *
 * Shape exacto (matchea `AdminMetrics` del frontend):
 *   - totals.{users,active,pending,banned}
 *   - revenue.{total,paidUserCount}
 *   - predictions.{loaded,expected}  // expected = matchCount * activeEntryCount
 *   - nextMatch?: { id, kickoffAt, homeLabel, awayLabel }
 *   - sparklines.{usersByDay[14], revenueByDay[14]}
 *
 * Performance: para ~500 users + ~104 matches todas las queries se
 * resuelven en <100ms en local. Si crece más, el cache del NestJS
 * (CacheModule, ya usado en /matches/upcoming) puede envolverlo con
 * TTL ~30s sin perder utilidad para el admin.
 */
@Controller('admin/metrics')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminMetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const now = new Date();
    // Inicio del día -13 (UTC) para tener exactamente 14 días incluyendo
    // hoy. Alineado a midnight UTC; el cliente puede asumir días UTC.
    const sparklineFrom = new Date(now);
    sparklineFrom.setUTCHours(0, 0, 0, 0);
    sparklineFrom.setUTCDate(sparklineFrom.getUTCDate() - (SPARKLINE_DAYS - 1));

    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      pendingPayments,
      revenueAgg,
      paidUsers,
      loadedPredictions,
      activeEntries,
      matchCount,
      nextMatch,
      userSparkline,
      revenueSparkline,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.user.count({
        where: { role: 'USER', status: 'ACTIVE' },
      }),
      this.prisma.user.count({
        where: { role: 'USER', status: 'BANNED' },
      }),
      this.prisma.payment.count({ where: { status: 'PENDING' } }),
      this.prisma.payment.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true },
      }),
      this.prisma.payment.findMany({
        where: { status: 'APPROVED', userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.prediction.count(),
      this.prisma.entry.count({ where: { status: 'ACTIVE' } }),
      this.prisma.match.count(),
      this.prisma.match.findFirst({
        where: { status: 'SCHEDULED', kickoffAt: { gt: now } },
        orderBy: { kickoffAt: 'asc' },
        select: {
          id: true,
          kickoffAt: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; n: bigint }>>`
        SELECT date_trunc('day', "createdAt") as day, COUNT(*)::bigint as n
        FROM users
        WHERE role = 'USER' AND "createdAt" >= ${sparklineFrom}
        GROUP BY 1
        ORDER BY 1
      `,
      this.prisma.$queryRaw<Array<{ day: Date; total: number }>>`
        SELECT date_trunc('day', "paidAt") as day, COALESCE(SUM(amount)::float, 0) as total
        FROM payments
        WHERE status = 'APPROVED' AND "paidAt" >= ${sparklineFrom}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

    return {
      totals: {
        users: totalUsers,
        active: activeUsers,
        pending: pendingPayments,
        banned: bannedUsers,
      },
      revenue: {
        total: Number(revenueAgg._sum.amount ?? 0),
        paidUserCount: paidUsers.length,
      },
      predictions: {
        loaded: loadedPredictions,
        expected: matchCount * activeEntries,
      },
      nextMatch: nextMatch
        ? {
            id: nextMatch.id,
            kickoffAt: nextMatch.kickoffAt.toISOString(),
            homeLabel: nextMatch.homeTeam?.name ?? 'TBD',
            awayLabel: nextMatch.awayTeam?.name ?? 'TBD',
          }
        : null,
      sparklines: {
        usersByDay: buildSparkline(userSparkline, sparklineFrom, (r) =>
          Number(r.n),
        ),
        revenueByDay: buildSparkline(revenueSparkline, sparklineFrom, (r) =>
          Number(r.total),
        ),
      },
    };
  }
}

/**
 * Convierte rows agregadas por `date_trunc('day', x)` en un array fijo de
 * `SPARKLINE_DAYS` valores, indexado por offset desde `from` (UTC).
 * Días sin actividad se rellenan con 0 — sin ese fill el array tendría
 * gaps y la sparkline del frontend renderiría mal.
 */
function buildSparkline<T extends { day: Date }>(
  rows: T[],
  from: Date,
  pick: (row: T) => number,
): number[] {
  const out = Array<number>(SPARKLINE_DAYS).fill(0);
  for (const row of rows) {
    const offsetMs = row.day.getTime() - from.getTime();
    const offsetDays = Math.floor(offsetMs / (24 * 60 * 60 * 1000));
    if (offsetDays >= 0 && offsetDays < SPARKLINE_DAYS) {
      out[offsetDays] = pick(row);
    }
  }
  return out;
}
