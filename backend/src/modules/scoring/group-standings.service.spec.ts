import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { GroupStandingsService } from './group-standings.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Pure unit tests for `GroupStandingsService`. We mock `PrismaService`
 * with `jest.fn()` factories that return canned arrays — no DB roundtrip.
 *
 * The fixture shape mirrors the prod schema for Team (groupCode is a
 * single letter A..L) and Match (phase=GROUPS, status FINISHED carries
 * scoreHome/scoreAway).
 */

type StubTeam = {
  id: string;
  name: string;
  shortName: string;
  flagUrl: string;
  groupCode: string | null;
};

type StubMatch = {
  id: string;
  phase: 'GROUPS';
  groupCode: string | null;
  status: 'FINISHED';
  homeTeamId: string | null;
  awayTeamId: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
};

function teamOf(id: string, name: string, groupCode = 'A'): StubTeam {
  return {
    id,
    name,
    shortName: name.slice(0, 3).toUpperCase(),
    flagUrl: `https://example.com/${id}.png`,
    groupCode,
  };
}

function matchOf(
  groupCode: string,
  homeTeamId: string,
  awayTeamId: string,
  scoreHome: number,
  scoreAway: number,
  idx = Math.random().toString(36).slice(2),
): StubMatch {
  return {
    id: `m-${idx}`,
    phase: 'GROUPS',
    groupCode,
    status: 'FINISHED',
    homeTeamId,
    awayTeamId,
    scoreHome,
    scoreAway,
  };
}

interface PrismaStub {
  team: { findMany: ReturnType<typeof jest.fn> };
  match: { findMany: ReturnType<typeof jest.fn> };
}

function buildPrismaStub(teams: StubTeam[], matches: StubMatch[]): PrismaStub {
  const teamFindMany = jest.fn(async (args: any) => {
    if (args?.where?.groupCode && typeof args.where.groupCode === 'string') {
      return teams
        .filter((t) => t.groupCode === args.where.groupCode)
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    // distinct groupCode form
    if (args?.distinct?.includes?.('groupCode')) {
      const codes = Array.from(
        new Set(teams.map((t) => t.groupCode).filter(Boolean)),
      ).map((c) => ({ groupCode: c }));
      return codes;
    }
    return teams;
  });
  const matchFindMany = jest.fn(async (args: any) => {
    return matches.filter(
      (m) =>
        m.phase === 'GROUPS' &&
        m.status === 'FINISHED' &&
        m.groupCode === args?.where?.groupCode,
    );
  });
  return {
    team: { findMany: teamFindMany },
    match: { findMany: matchFindMany },
  };
}

async function makeService(prismaStub: PrismaStub): Promise<GroupStandingsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      GroupStandingsService,
      { provide: PrismaService, useValue: prismaStub },
    ],
  }).compile();
  return moduleRef.get(GroupStandingsService);
}

describe('GroupStandingsService', () => {
  it('computes PJ/PG/PE/PP/GF/GC/DG/PTS over 6 FINISHED matches of a group', async () => {
    const ARG = teamOf('t-arg', 'Argentina');
    const MEX = teamOf('t-mex', 'México');
    const POL = teamOf('t-pol', 'Polonia');
    const SAU = teamOf('t-sau', 'Arabia Saudita');
    const matches: StubMatch[] = [
      matchOf('A', ARG.id, SAU.id, 2, 0, '1'),
      matchOf('A', MEX.id, POL.id, 1, 1, '2'),
      matchOf('A', ARG.id, MEX.id, 2, 1, '3'),
      matchOf('A', POL.id, SAU.id, 2, 0, '4'),
      matchOf('A', ARG.id, POL.id, 1, 1, '5'),
      matchOf('A', MEX.id, SAU.id, 2, 1, '6'),
    ];
    const service = await makeService(buildPrismaStub([ARG, MEX, POL, SAU], matches));

    const standings = await service.getGroupStandings('A');

    expect(standings).toHaveLength(4);

    const byId = Object.fromEntries(standings.map((s) => [s.teamId, s]));

    expect(byId[ARG.id]).toMatchObject({
      pj: 3, pg: 2, pe: 1, pp: 0, gf: 5, gc: 2, dg: 3, pts: 7,
    });
    expect(byId[POL.id]).toMatchObject({
      pj: 3, pg: 1, pe: 2, pp: 0, gf: 4, gc: 2, dg: 2, pts: 5,
    });
    expect(byId[MEX.id]).toMatchObject({
      pj: 3, pg: 1, pe: 1, pp: 1, gf: 4, gc: 4, dg: 0, pts: 4,
    });
    expect(byId[SAU.id]).toMatchObject({
      pj: 3, pg: 0, pe: 0, pp: 3, gf: 1, gc: 6, dg: -5, pts: 0,
    });

    expect(standings.map((s) => s.teamId)).toEqual([ARG.id, POL.id, MEX.id, SAU.id]);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });

  it('orders by PTS DESC → DG DESC → GF DESC', async () => {
    // Three teams tied on PTS with different DGs, plus a tail team that
    // splits two of them on GF as last tiebreaker.
    const T1 = teamOf('t-1', 'Team1');
    const T2 = teamOf('t-2', 'Team2');
    const T3 = teamOf('t-3', 'Team3');
    const T4 = teamOf('t-4', 'Team4');
    // Want PTS DESC outcome ranking, then DG, then GF.
    // Construct:
    //  T1: 1W vs T4 (3-0)  → 3pts, DG +3, GF 3
    //  T2: 1W vs T4 (2-0)  → 3pts, DG +2, GF 2
    //  T3: 1W vs T4 (1-0)  → 3pts, DG +1, GF 1
    //  T4: 0pts
    const matches: StubMatch[] = [
      matchOf('A', T1.id, T4.id, 3, 0, 'a'),
      matchOf('A', T2.id, T4.id, 2, 0, 'b'),
      matchOf('A', T3.id, T4.id, 1, 0, 'c'),
    ];
    const service = await makeService(buildPrismaStub([T1, T2, T3, T4], matches));
    const standings = await service.getGroupStandings('A');

    expect(standings.map((s) => s.teamId)).toEqual([T1.id, T2.id, T3.id, T4.id]);
    expect(standings.map((s) => s.pts)).toEqual([3, 3, 3, 0]);
    expect(standings.map((s) => s.dg)).toEqual([3, 2, 1, -6]);

    // Sanity: now tie PTS+DG between T2 and T3 → GF decides.
    const matches2: StubMatch[] = [
      // T1: 1W vs T4 (3-0)
      matchOf('A', T1.id, T4.id, 3, 0, 'a'),
      // T2: 2-1 vs T4 → 3pts DG +1 GF 2
      matchOf('A', T2.id, T4.id, 2, 1, 'b'),
      // T3: 1-0 vs T4 → 3pts DG +1 GF 1
      matchOf('A', T3.id, T4.id, 1, 0, 'c'),
    ];
    const service2 = await makeService(buildPrismaStub([T1, T2, T3, T4], matches2));
    const standings2 = await service2.getGroupStandings('A');
    expect(standings2.map((s) => s.teamId)).toEqual([T1.id, T2.id, T3.id, T4.id]);
    expect(standings2[1].dg).toBe(standings2[2].dg);
    expect(standings2[1].gf).toBeGreaterThan(standings2[2].gf);
  });

  it('returns 4 teams with all-zero stats when group has 0 finished matches', async () => {
    // Intentionally pass teams out of id-asc order to verify the service
    // sorts the empty fallback by team id ascending.
    const Tc = teamOf('t-c', 'C');
    const Ta = teamOf('t-a', 'A');
    const Td = teamOf('t-d', 'D');
    const Tb = teamOf('t-b', 'B');
    const service = await makeService(buildPrismaStub([Tc, Ta, Td, Tb], []));
    const standings = await service.getGroupStandings('A');

    expect(standings).toHaveLength(4);
    expect(standings.map((s) => s.teamId)).toEqual(['t-a', 't-b', 't-c', 't-d']);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    for (const s of standings) {
      expect(s.pj).toBe(0);
      expect(s.pg).toBe(0);
      expect(s.pe).toBe(0);
      expect(s.pp).toBe(0);
      expect(s.gf).toBe(0);
      expect(s.gc).toBe(0);
      expect(s.dg).toBe(0);
      expect(s.pts).toBe(0);
    }
  });

  it('handles partial groups (3 of 6 matches finished)', async () => {
    const ARG = teamOf('t-arg', 'Argentina');
    const MEX = teamOf('t-mex', 'México');
    const POL = teamOf('t-pol', 'Polonia');
    const SAU = teamOf('t-sau', 'Arabia Saudita');
    // First 3 of the canonical fixture only.
    const matches: StubMatch[] = [
      matchOf('A', ARG.id, SAU.id, 2, 0, '1'), // ARG 3pts +2; SAU 0pts -2
      matchOf('A', MEX.id, POL.id, 1, 1, '2'), // MEX 1pt 0; POL 1pt 0
      matchOf('A', ARG.id, MEX.id, 2, 1, '3'), // ARG 6pts +3; MEX 1pt -1
    ];
    const service = await makeService(buildPrismaStub([ARG, MEX, POL, SAU], matches));
    const standings = await service.getGroupStandings('A');

    const byId = Object.fromEntries(standings.map((s) => [s.teamId, s]));
    expect(byId[ARG.id]).toMatchObject({ pj: 2, pg: 2, pe: 0, pp: 0, gf: 4, gc: 1, dg: 3, pts: 6 });
    expect(byId[POL.id]).toMatchObject({ pj: 1, pg: 0, pe: 1, pp: 0, gf: 1, gc: 1, dg: 0, pts: 1 });
    expect(byId[MEX.id]).toMatchObject({ pj: 2, pg: 0, pe: 1, pp: 1, gf: 2, gc: 3, dg: -1, pts: 1 });
    expect(byId[SAU.id]).toMatchObject({ pj: 1, pg: 0, pe: 0, pp: 1, gf: 0, gc: 2, dg: -2, pts: 0 });

    // Order: PTS DESC → DG DESC → GF DESC.
    // ARG(6) > POL(1, DG 0, GF 1) > MEX(1, DG -1) > SAU(0).
    expect(standings.map((s) => s.teamId)).toEqual([ARG.id, POL.id, MEX.id, SAU.id]);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });
});
