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
});
