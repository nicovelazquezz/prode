import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * A row in a group's standings table. `position` is 1..N assigned after
 * sorting by PTS DESC → DG DESC → GF DESC. Stable for empty groups via
 * team id ascending order from the underlying `findMany`.
 */
export interface GroupStanding {
  teamId: string;
  teamName: string;
  teamShortName: string;
  teamFlagUrl: string;
  /** Partidos jugados (FINISHED). */
  pj: number;
  /** Partidos ganados. */
  pg: number;
  /** Partidos empatados. */
  pe: number;
  /** Partidos perdidos. */
  pp: number;
  /** Goles a favor. */
  gf: number;
  /** Goles en contra. */
  gc: number;
  /** Diferencia de goles (gf - gc). */
  dg: number;
  /** Puntos (3 por victoria, 1 por empate). */
  pts: number;
  /** Posición 1..N en la tabla del grupo. */
  position: number;
}

/**
 * Pure read-side projection of group standings, computed on-demand from
 * the `Match` table. No persisted snapshot — `GET /groups/standings` (Task
 * 7) caches the aggregate response for 60s and invalidates from
 * `ScoringService` on group-match finalization.
 *
 * Algorithm: load all teams in the group ordered by id ascending, then
 * fold every FINISHED match into per-team counters, derive `dg = gf - gc`,
 * sort by (PTS DESC, DG DESC, GF DESC), and assign `position = i + 1`.
 *
 * Groups with 0 finished matches return all 4 teams with zeroed stats in
 * stable team-id order so the UI can still render the empty table.
 */
@Injectable()
export class GroupStandingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGroupStandings(groupCode: string): Promise<GroupStanding[]> {
    const teams = await this.prisma.team.findMany({
      where: { groupCode },
      orderBy: { id: 'asc' },
    });
    const matches = await this.prisma.match.findMany({
      where: { phase: 'GROUPS', groupCode, status: 'FINISHED' },
    });

    const stats = new Map<string, Omit<GroupStanding, 'position' | 'dg'>>();
    for (const t of teams) {
      stats.set(t.id, {
        teamId: t.id,
        teamName: t.name,
        teamShortName: t.shortName,
        teamFlagUrl: t.flagUrl,
        pj: 0,
        pg: 0,
        pe: 0,
        pp: 0,
        gf: 0,
        gc: 0,
        pts: 0,
      });
    }

    for (const m of matches) {
      if (m.homeTeamId === null || m.awayTeamId === null) continue;
      if (m.scoreHome === null || m.scoreAway === null) continue;
      const h = stats.get(m.homeTeamId);
      const a = stats.get(m.awayTeamId);
      if (!h || !a) continue;
      h.pj++;
      a.pj++;
      h.gf += m.scoreHome;
      h.gc += m.scoreAway;
      a.gf += m.scoreAway;
      a.gc += m.scoreHome;
      if (m.scoreHome > m.scoreAway) {
        h.pg++;
        a.pp++;
        h.pts += 3;
      } else if (m.scoreHome < m.scoreAway) {
        a.pg++;
        h.pp++;
        a.pts += 3;
      } else {
        h.pe++;
        a.pe++;
        h.pts++;
        a.pts++;
      }
    }

    const arr = Array.from(stats.values()).map((s) => ({
      ...s,
      dg: s.gf - s.gc,
    }));
    arr.sort((x, y) => y.pts - x.pts || y.dg - x.dg || y.gf - x.gf);
    return arr.map((s, i) => ({ ...s, position: i + 1 }));
  }

  async getAllGroupStandings(): Promise<Record<string, GroupStanding[]>> {
    const groupCodes = await this.prisma.team.findMany({
      where: { groupCode: { not: null } },
      select: { groupCode: true },
      distinct: ['groupCode'],
    });
    const out: Record<string, GroupStanding[]> = {};
    for (const { groupCode } of groupCodes) {
      if (!groupCode) continue;
      out[groupCode] = await this.getGroupStandings(groupCode);
    }
    return out;
  }
}
