import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { LeaderboardRepository } from './leaderboard.repository.js';

/**
 * Repository-level integration tests for the public leaderboard reads.
 * Drives real Postgres queries against the seeded schema (incl. the
 * `leaderboard_global` materialized view) so we exercise the actual SQL
 * and column-quoting choices.
 *
 * Test data is namespaced with a process-local stamp so concurrent runs
 * don't collide on the unique DNI/whatsapp constraints.
 */
describe('LeaderboardRepository (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: LeaderboardRepository;

  // Stamp combines wall-clock millis + a random nonce so re-runs against
  // a sticky DB don't collide on unique constraints.
  const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
  const userIds: string[] = [];
  const entryIds: string[] = [];
  let leagueId: string | null = null;
  let matchId: string;
  // Snapshot of the original match state so the suite can restore it.
  let matchSnapshot: {
    status: 'SCHEDULED' | 'LOCKED' | 'IN_PROGRESS' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
    scoreHome: number | null;
    scoreAway: number | null;
    finishedAt: Date | null;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    repo = app.get(LeaderboardRepository);

    // Pick an unused match (matchNumber 64 — outside the ranges other
    // suites use: 60-63, 70-71). Snapshot + flip to FINISHED so
    // pointsEarned aggregations have something to work with.
    const match = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 64 },
    });
    matchId = match.id;
    matchSnapshot = {
      status: match.status,
      scoreHome: match.scoreHome,
      scoreAway: match.scoreAway,
      finishedAt: match.finishedAt,
    };
    await prisma.prediction.deleteMany({ where: { matchId } });
    await prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'FINISHED',
        scoreHome: 2,
        scoreAway: 1,
        finishedAt: new Date(),
      },
    });

    // Three users: alpha (5 EXACT pts), beta (1 hit), gamma (no preds).
    // Multi-prode: each user has Entry #1 backed by an APPROVED Payment.
    const users = await Promise.all(
      ['Alpha', 'Beta', 'Gamma'].map((name, i) =>
        prisma.user.create({
          data: {
            dni: String(70_000_000 + stamp + i).slice(-8),
            firstName: 'Lb',
            lastName: name,
            whatsapp: `549${String(7_000_000_000 + stamp + i).slice(-9)}`.slice(0, 13),
            passwordHash: 'unused',
          },
        }),
      ),
    );
    userIds.push(...users.map((u) => u.id));

    for (const u of users) {
      const payment = await prisma.payment.create({
        data: {
          userId: u.id,
          amount: 10_000,
          method: 'CASH',
          status: 'APPROVED',
          paidAt: new Date(),
          completedAt: new Date(),
        },
      });
      const entry = await prisma.entry.create({
        data: {
          userId: u.id,
          paymentId: payment.id,
          position: 1,
          status: 'ACTIVE',
        },
      });
      entryIds.push(entry.id);
    }

    // alpha — EXACT prediction, 5 base × 1.0 multiplier (GROUPS).
    await prisma.prediction.create({
      data: {
        entryId: entryIds[0],
        matchId,
        scoreHome: 2,
        scoreAway: 1,
        outcomeType: 'EXACT',
        basePoints: 5,
        multiplier: 1,
        pointsEarned: 5,
        evaluatedAt: new Date(),
      },
    });
    // beta — WINNER_ONLY hit, 1 point.
    await prisma.prediction.create({
      data: {
        entryId: entryIds[1],
        matchId,
        scoreHome: 3,
        scoreAway: 0,
        outcomeType: 'WINNER_ONLY',
        basePoints: 1,
        multiplier: 1,
        pointsEarned: 1,
        evaluatedAt: new Date(),
      },
    });
    // gamma — no prediction, no points. Still appears in MV with 0.

    // Create a league with alpha's entry + gamma's entry as members (skip beta).
    const league = await prisma.league.create({
      data: {
        name: `Lb-Test-League-${stamp}`,
        inviteCode: `LB${stamp}`.slice(0, 16),
        ownerId: users[0].id,
        members: {
          create: [{ entryId: entryIds[0] }, { entryId: entryIds[2] }],
        },
      },
    });
    leagueId = league.id;

    // Refresh the MV so the new pointsEarned values land in the global ladder.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
  }, 60_000);

  afterAll(async () => {
    if (!prisma) {
      if (app) await app.close();
      return;
    }
    if (leagueId) {
      await prisma.leagueMembership.deleteMany({ where: { leagueId } });
      await prisma.league.delete({ where: { id: leagueId } }).catch(() => undefined);
    }
    if (userIds.length) {
      // Predictions cascade off entries; deleting the user wipes the
      // entry → prediction tree via FK CASCADE.
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (matchId) {
      await prisma.prediction.deleteMany({ where: { matchId } });
      await prisma.match.update({
        where: { id: matchId },
        data: matchSnapshot,
      });
    }
    // Final refresh so the MV doesn't carry our test users into other suites.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;
    if (app) await app.close();
  }, 30_000);

  it('getGlobal: returns paged rows with the alpha entry above beta', async () => {
    const { rows, total } = await repo.getGlobal(1, 200);

    const alpha = rows.find((r) => r.entry_id === entryIds[0]);
    const beta = rows.find((r) => r.entry_id === entryIds[1]);
    const gamma = rows.find((r) => r.entry_id === entryIds[2]);

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(gamma).toBeDefined();
    expect(alpha!.total_points).toBe(5);
    expect(alpha!.exact_count).toBe(1);
    expect(alpha!.hits_count).toBe(1);
    expect(beta!.total_points).toBe(1);
    expect(beta!.exact_count).toBe(0);
    expect(beta!.hits_count).toBe(1);
    expect(gamma!.total_points).toBe(0);
    expect(typeof total).toBe('number');
    expect(total).toBeGreaterThanOrEqual(3);

    // Order check: alpha must precede beta in the list.
    const indexAlpha = rows.findIndex((r) => r.entry_id === entryIds[0]);
    const indexBeta = rows.findIndex((r) => r.entry_id === entryIds[1]);
    expect(indexAlpha).toBeLessThan(indexBeta);
  });

  it('getGlobalAroundEntry: returns alpha at her own rank with neighbours', async () => {
    const around = await repo.getGlobalAroundEntry(entryIds[0], 1);
    expect(around.length).toBeGreaterThan(0);
    const me = around.find((r) => r.entry_id === entryIds[0]);
    expect(me).toBeDefined();
    expect(me!.total_points).toBe(5);
    expect(typeof me!.rank).toBe('number');
    // The slice is sorted ascending by rank.
    for (let i = 1; i < around.length; i++) {
      expect(around[i].rank).toBeGreaterThanOrEqual(around[i - 1].rank);
    }
  });

  it('getByPhase(GROUPS): aggregates only matches of the given phase', async () => {
    const { rows } = await repo.getByPhase('GROUPS', 1, 200);
    const alpha = rows.find((r) => r.entry_id === entryIds[0]);
    expect(alpha).toBeDefined();
    expect(alpha!.total_points).toBe(5);
    expect(alpha!.exact_count).toBe(1);
    expect(alpha!.hits_count).toBe(1);

    // Other phases should have alpha at 0 — the LEFT JOIN m.phase = X
    // filter ensures predictions for non-matching phases drop out.
    const { rows: finalRows } = await repo.getByPhase('FINAL', 1, 200);
    const alphaFinal = finalRows.find((r) => r.entry_id === entryIds[0]);
    expect(alphaFinal).toBeDefined();
    expect(alphaFinal!.total_points).toBe(0);
  });

  it('getByLeague: only returns members of that league', async () => {
    const { rows, total } = await repo.getByLeague(leagueId!, 1, 200);
    const ids = rows.map((r) => r.entry_id);
    expect(ids).toContain(entryIds[0]); // alpha — member, has points
    expect(ids).toContain(entryIds[2]); // gamma — member, 0 points
    expect(ids).not.toContain(entryIds[1]); // beta — not a member
    expect(total).toBe(2);

    // Tie-break ordering: alpha (5 pts) ahead of gamma (0 pts).
    const indexAlpha = rows.findIndex((r) => r.entry_id === entryIds[0]);
    const indexGamma = rows.findIndex((r) => r.entry_id === entryIds[2]);
    expect(indexAlpha).toBeLessThan(indexGamma);
  });
});
