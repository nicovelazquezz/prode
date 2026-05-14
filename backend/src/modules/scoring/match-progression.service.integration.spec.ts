import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MatchProgressionService } from './match-progression.service.js';
import { AdminAlertsService } from '../../shared/admin-alerts/admin-alerts.service.js';

/**
 * Integration tests for the elimination-bracket populator.
 *
 * Strategy: drive the full pipeline ROUND_32 → ROUND_16 against the seed
 * data without polluting it. Setup:
 *
 *   1. Pick the 2 ROUND_32 matches mapped to ROUND_16 #89 (matches #73
 *      and #74) and force them FINISHED with a deterministic winner.
 *   2. Snapshot the target ROUND_16 match #89 (homeTeamId, awayTeamId,
 *      predictionsOpenAt, status) so we can restore it on teardown.
 *   3. Run `populateRound16Matches`.
 *   4. Assert match #89 picked up the expected winners.
 *
 * GROUPS → ROUND_32 isn't covered with bracket-level assertions because
 * Task 8.8 documents that step as deferred to admin (FIFA 2026 rules).
 * We DO assert that calling it pings AdminAlerts, which is the documented
 * behaviour.
 *
 * Cleanup is rigorous because we mutate matches the rest of the test
 * suite reads.
 */
describe('MatchProgressionService (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let progression: MatchProgressionService;
  let alertsSpy: ReturnType<typeof jest.spyOn>;

  type MatchSnapshot = {
    matchNumber: number;
    id: string;
    status: string;
    scoreHome: number | null;
    scoreAway: number | null;
    finishedAt: Date | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
    predictionsOpenAt: Date | null;
    winnerTeamId: string | null;
  };
  const snapshots: MatchSnapshot[] = [];

  async function snapshot(matchNumber: number): Promise<MatchSnapshot> {
    const m = await prisma.match.findFirstOrThrow({ where: { matchNumber } });
    return {
      matchNumber: m.matchNumber,
      id: m.id,
      status: m.status,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      finishedAt: m.finishedAt,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      predictionsOpenAt: m.predictionsOpenAt,
      winnerTeamId: m.winnerTeamId,
    };
  }

  async function restoreSnapshot(s: MatchSnapshot): Promise<void> {
    await prisma.match.update({
      where: { id: s.id },
      data: {
        status: s.status as MatchSnapshot['status'] as 'SCHEDULED',
        scoreHome: s.scoreHome,
        scoreAway: s.scoreAway,
        finishedAt: s.finishedAt,
        homeTeamId: s.homeTeamId,
        awayTeamId: s.awayTeamId,
        predictionsOpenAt: s.predictionsOpenAt,
        winnerTeamId: s.winnerTeamId,
      },
    });
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    progression = app.get(MatchProgressionService);
    const alerts = app.get(AdminAlertsService);
    // Stub notifications so the test doesn't actually queue anything.
    alertsSpy = jest.spyOn(alerts, 'notify').mockResolvedValue();

    // Snapshot every match we will mutate (R32 #73, #74; R16 #89).
    snapshots.push(await snapshot(73));
    snapshots.push(await snapshot(74));
    snapshots.push(await snapshot(89));
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Restore in reverse order: targets first (so unsetting their team
      // ids doesn't strand source-team references), then sources.
      for (const s of [...snapshots].reverse()) {
        await restoreSnapshot(s);
      }
    }
    if (alertsSpy) alertsSpy.mockRestore();
    if (app) await app.close();
  }, 30_000);

  it('populateRound16Matches assigns winners of consecutive R32 matches to R16 #89', async () => {
    // Need two real teams to use as winners. Pick the first two from the
    // seed (any two distinct teams are fine).
    const teams = await prisma.team.findMany({ take: 4, orderBy: { fifaCode: 'asc' } });
    expect(teams.length).toBeGreaterThanOrEqual(4);

    // Force R32 #73 FINISHED with team0 winning (home wins 2-0).
    await prisma.match.update({
      where: { matchNumber: 73 },
      data: {
        status: 'FINISHED',
        scoreHome: 2,
        scoreAway: 0,
        finishedAt: new Date(),
        homeTeamId: teams[0].id,
        awayTeamId: teams[1].id,
      },
    });
    // Force R32 #74 FINISHED with team3 winning (away wins 1-3).
    await prisma.match.update({
      where: { matchNumber: 74 },
      data: {
        status: 'FINISHED',
        scoreHome: 1,
        scoreAway: 3,
        finishedAt: new Date(),
        homeTeamId: teams[2].id,
        awayTeamId: teams[3].id,
      },
    });
    // Reset target #89 — make sure it starts unassigned so the populator
    // does work.
    await prisma.match.update({
      where: { matchNumber: 89 },
      data: {
        homeTeamId: null,
        awayTeamId: null,
        predictionsOpenAt: null,
      },
    });

    await progression.populateRound16Matches();

    const r16 = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 89 },
    });
    // R16 #89 takes winner of R32 #73 (team0, home) and winner of R32 #74 (team3, away).
    expect(r16.homeTeamId).toBe(teams[0].id);
    expect(r16.awayTeamId).toBe(teams[3].id);
    expect(r16.predictionsOpenAt).toBeInstanceOf(Date);
  });

  it('populateRound16Matches is idempotent — re-running over a populated target is a no-op', async () => {
    // The previous test populated #89. Capture its predictionsOpenAt and
    // verify it doesn't change on a second call.
    const before = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 89 },
    });
    const beforeOpenAt = before.predictionsOpenAt;
    expect(beforeOpenAt).not.toBeNull();

    // Wait briefly so a re-write would have a measurably different timestamp.
    await new Promise((r) => setTimeout(r, 50));
    await progression.populateRound16Matches();

    const after = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 89 },
    });
    expect(after.predictionsOpenAt?.getTime()).toBe(beforeOpenAt!.getTime());
    expect(after.homeTeamId).toBe(before.homeTeamId);
    expect(after.awayTeamId).toBe(before.awayTeamId);
  });

  it('populateRound32Matches alerts the admin and skips automated assignment', async () => {
    alertsSpy.mockClear();
    await progression.populateRound32Matches();
    expect(alertsSpy).toHaveBeenCalledTimes(1);
    const arg = alertsSpy.mock.calls[0][0] as { type: string; dedupKey?: string };
    expect(arg.type).toBe('PHASE_PROGRESSION_MANUAL_REVIEW');
    expect(arg.dedupKey).toBe('phase-progression:GROUPS->ROUND_32');
  });

  it('alerts the admin when a source match is a draw (no penalties in schema)', async () => {
    alertsSpy.mockClear();
    const teams = await prisma.team.findMany({ take: 4, orderBy: { fifaCode: 'asc' } });

    // Force R32 #73 FINISHED as a draw.
    await prisma.match.update({
      where: { matchNumber: 73 },
      data: {
        status: 'FINISHED',
        scoreHome: 1,
        scoreAway: 1,
        finishedAt: new Date(),
        homeTeamId: teams[0].id,
        awayTeamId: teams[1].id,
      },
    });
    // R32 #74 stays as in the previous test (away wins 1-3).

    // Reset target so populator considers it.
    await prisma.match.update({
      where: { matchNumber: 89 },
      data: {
        homeTeamId: null,
        awayTeamId: null,
        predictionsOpenAt: null,
      },
    });

    await progression.populateRound16Matches();
    expect(alertsSpy).toHaveBeenCalled();
    const types = alertsSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain('PHASE_PROGRESSION_DRAW_NEEDS_REVIEW');
  });

  describe('pickTeam with winnerTeamId (knockout ties)', () => {
    // These tests exercise `pickTeam` indirectly through the public
    // populator. The matches are forced into a tied state with
    // `winnerTeamId` set/unset to confirm the populator now respects the
    // tiebreaker column instead of always alerting on draws.

    it('uses winnerTeamId when scores are tied (winner path: ROUND_32 → ROUND_16)', async () => {
      alertsSpy.mockClear();
      const teams = await prisma.team.findMany({ take: 4, orderBy: { fifaCode: 'asc' } });

      // R32 #73: 1-1 with home team flagged as winner.
      await prisma.match.update({
        where: { matchNumber: 73 },
        data: {
          status: 'FINISHED',
          scoreHome: 1,
          scoreAway: 1,
          finishedAt: new Date(),
          homeTeamId: teams[0].id,
          awayTeamId: teams[1].id,
          winnerTeamId: teams[0].id,
        },
      });
      // R32 #74: 0-0 with AWAY team flagged as winner.
      await prisma.match.update({
        where: { matchNumber: 74 },
        data: {
          status: 'FINISHED',
          scoreHome: 0,
          scoreAway: 0,
          finishedAt: new Date(),
          homeTeamId: teams[2].id,
          awayTeamId: teams[3].id,
          winnerTeamId: teams[3].id,
        },
      });
      // Reset target so the populator does work.
      await prisma.match.update({
        where: { matchNumber: 89 },
        data: {
          homeTeamId: null,
          awayTeamId: null,
          predictionsOpenAt: null,
        },
      });

      await progression.populateRound16Matches();

      const r16 = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 89 },
      });
      // Winner of #73 = teams[0] (home), winner of #74 = teams[3] (away).
      expect(r16.homeTeamId).toBe(teams[0].id);
      expect(r16.awayTeamId).toBe(teams[3].id);
      expect(r16.predictionsOpenAt).toBeInstanceOf(Date);
      // Critical: no draw alerts should have fired.
      const types = alertsSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).not.toContain('PHASE_PROGRESSION_DRAW_NEEDS_REVIEW');
    });

    it('uses winnerTeamId for loser path (SEMIS → THIRD_PLACE)', async () => {
      alertsSpy.mockClear();
      const teams = await prisma.team.findMany({ take: 4, orderBy: { fifaCode: 'asc' } });

      // Snapshot SEMIS (#101, #102) and FINAL (#104) and THIRD_PLACE (#103)
      // so we can restore them — not added to the outer snapshots list,
      // we restore inline at the end of this test.
      const sem101Snap = await snapshot(101);
      const sem102Snap = await snapshot(102);
      const thirdSnap = await snapshot(103);
      const finalSnap = await snapshot(104);

      try {
        // SEMI #101: 2-2 tie, winnerTeamId = home → loser = away (teams[1]).
        await prisma.match.update({
          where: { matchNumber: 101 },
          data: {
            status: 'FINISHED',
            scoreHome: 2,
            scoreAway: 2,
            finishedAt: new Date(),
            homeTeamId: teams[0].id,
            awayTeamId: teams[1].id,
            winnerTeamId: teams[0].id,
          },
        });
        // SEMI #102: 0-0 tie, winnerTeamId = away → loser = home (teams[2]).
        await prisma.match.update({
          where: { matchNumber: 102 },
          data: {
            status: 'FINISHED',
            scoreHome: 0,
            scoreAway: 0,
            finishedAt: new Date(),
            homeTeamId: teams[2].id,
            awayTeamId: teams[3].id,
            winnerTeamId: teams[3].id,
          },
        });
        // Reset targets.
        await prisma.match.update({
          where: { matchNumber: 103 },
          data: { homeTeamId: null, awayTeamId: null, predictionsOpenAt: null },
        });
        await prisma.match.update({
          where: { matchNumber: 104 },
          data: { homeTeamId: null, awayTeamId: null, predictionsOpenAt: null },
        });

        await progression.populateFinalMatches();

        const third = await prisma.match.findFirstOrThrow({
          where: { matchNumber: 103 },
        });
        // Loser of #101 = teams[1], loser of #102 = teams[2].
        expect(third.homeTeamId).toBe(teams[1].id);
        expect(third.awayTeamId).toBe(teams[2].id);

        const final = await prisma.match.findFirstOrThrow({
          where: { matchNumber: 104 },
        });
        // Winner of #101 = teams[0], winner of #102 = teams[3].
        expect(final.homeTeamId).toBe(teams[0].id);
        expect(final.awayTeamId).toBe(teams[3].id);

        const types = alertsSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
        expect(types).not.toContain('PHASE_PROGRESSION_DRAW_NEEDS_REVIEW');
      } finally {
        // Inline restore (in reverse order of mutation).
        await restoreSnapshot(finalSnap);
        await restoreSnapshot(thirdSnap);
        await restoreSnapshot(sem102Snap);
        await restoreSnapshot(sem101Snap);
      }
    });

    it('returns null and alerts when scores are tied AND winnerTeamId is null (legacy)', async () => {
      alertsSpy.mockClear();
      const teams = await prisma.team.findMany({ take: 4, orderBy: { fifaCode: 'asc' } });

      // R32 #73: 1-1 with NO winnerTeamId set.
      await prisma.match.update({
        where: { matchNumber: 73 },
        data: {
          status: 'FINISHED',
          scoreHome: 1,
          scoreAway: 1,
          finishedAt: new Date(),
          homeTeamId: teams[0].id,
          awayTeamId: teams[1].id,
          winnerTeamId: null,
        },
      });
      // R32 #74: 2-1 (regular non-draw to isolate the failure to #73).
      await prisma.match.update({
        where: { matchNumber: 74 },
        data: {
          status: 'FINISHED',
          scoreHome: 2,
          scoreAway: 1,
          finishedAt: new Date(),
          homeTeamId: teams[2].id,
          awayTeamId: teams[3].id,
          winnerTeamId: null,
        },
      });
      await prisma.match.update({
        where: { matchNumber: 89 },
        data: { homeTeamId: null, awayTeamId: null, predictionsOpenAt: null },
      });

      await progression.populateRound16Matches();

      // The draw alert must fire and the target should remain unassigned.
      const types = alertsSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('PHASE_PROGRESSION_DRAW_NEEDS_REVIEW');

      const r16 = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 89 },
      });
      expect(r16.homeTeamId).toBeNull();
      expect(r16.awayTeamId).toBeNull();
    });

    it('ignores winnerTeamId when scores differ (regular result wins)', async () => {
      alertsSpy.mockClear();
      const teams = await prisma.team.findMany({ take: 4, orderBy: { fifaCode: 'asc' } });

      // R32 #73: home wins 2-0 BUT winnerTeamId points to away.
      // The score is authoritative; winnerTeamId is ignored when not tied.
      await prisma.match.update({
        where: { matchNumber: 73 },
        data: {
          status: 'FINISHED',
          scoreHome: 2,
          scoreAway: 0,
          finishedAt: new Date(),
          homeTeamId: teams[0].id,
          awayTeamId: teams[1].id,
          winnerTeamId: teams[1].id, // pathological — should be ignored
        },
      });
      // R32 #74: away wins 1-3.
      await prisma.match.update({
        where: { matchNumber: 74 },
        data: {
          status: 'FINISHED',
          scoreHome: 1,
          scoreAway: 3,
          finishedAt: new Date(),
          homeTeamId: teams[2].id,
          awayTeamId: teams[3].id,
          winnerTeamId: null,
        },
      });
      await prisma.match.update({
        where: { matchNumber: 89 },
        data: { homeTeamId: null, awayTeamId: null, predictionsOpenAt: null },
      });

      await progression.populateRound16Matches();

      const r16 = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 89 },
      });
      // Scores differ → score winner wins regardless of winnerTeamId.
      expect(r16.homeTeamId).toBe(teams[0].id); // home of #73 won 2-0
      expect(r16.awayTeamId).toBe(teams[3].id); // away of #74 won 1-3
    });
  });
});
