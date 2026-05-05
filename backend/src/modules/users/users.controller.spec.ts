import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';

/**
 * Integration test for `GET /users/:id/public-profile`. Used by the
 * leaderboard drawer when an anonymous visitor (or any user) taps a
 * row — the contract is no auth required, no sensitive fields leaked,
 * and only FINISHED-match predictions surfaced.
 *
 * The fixture creates one user with two predictions: one against a
 * FINISHED match (must appear in the response) and one against a
 * SCHEDULED match (must NOT appear). A second BANNED user verifies
 * the 404-on-banned branch.
 */
describe('GET /users/:id/public-profile (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  let userId: string;
  let bannedUserId: string;
  let finishedMatchId: string;
  let scheduledMatchId: string;
  let teamAId: string;
  let teamBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    const dniSuffix = Date.now().toString().slice(-7);
    const passwordHash = await authService.hashPassword('whatever1');

    // Two seeded teams from the global seed; pick any two by fifaCode.
    // If they don't exist (test ran without seed), create lightweight
    // ones tagged with a suffix to avoid uniqueness collisions.
    const existing = await prisma.team.findMany({ take: 2 });
    if (existing.length >= 2) {
      teamAId = existing[0]!.id;
      teamBId = existing[1]!.id;
    } else {
      const a = await prisma.team.create({
        data: {
          fifaCode: `TS${dniSuffix.slice(0, 3)}`,
          name: 'Test A',
          shortName: 'TSA',
          flagUrl: 'https://example.local/a.svg',
          confederation: 'CONMEBOL',
        },
      });
      const b = await prisma.team.create({
        data: {
          fifaCode: `TT${dniSuffix.slice(0, 3)}`,
          name: 'Test B',
          shortName: 'TSB',
          flagUrl: 'https://example.local/b.svg',
          confederation: 'CONMEBOL',
        },
      });
      teamAId = a.id;
      teamBId = b.id;
    }

    // Find a unique matchNumber slot (seed uses 1-104; pick something
    // far higher).
    const baseMatchNumber = 9000 + Number(dniSuffix.slice(-3));
    const finished = await prisma.match.create({
      data: {
        matchNumber: baseMatchNumber,
        phase: 'GROUPS',
        homeTeamId: teamAId,
        awayTeamId: teamBId,
        kickoffAt: new Date(Date.now() - 86_400_000),
        predictionsLockAt: new Date(Date.now() - 86_400_000),
        status: 'FINISHED',
        scoreHome: 2,
        scoreAway: 1,
        finishedAt: new Date(Date.now() - 80_000_000),
      },
    });
    const scheduled = await prisma.match.create({
      data: {
        matchNumber: baseMatchNumber + 1,
        phase: 'GROUPS',
        homeTeamId: teamAId,
        awayTeamId: teamBId,
        kickoffAt: new Date(Date.now() + 86_400_000),
        predictionsLockAt: new Date(Date.now() + 86_400_000 - 600_000),
        status: 'SCHEDULED',
      },
    });
    finishedMatchId = finished.id;
    scheduledMatchId = scheduled.id;

    const user = await prisma.user.create({
      data: {
        dni: `4${dniSuffix}`,
        firstName: 'Public',
        lastName: 'Profile',
        whatsapp: `54914${dniSuffix}`,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    const banned = await prisma.user.create({
      data: {
        dni: `5${dniSuffix}`,
        firstName: 'Banned',
        lastName: 'User',
        whatsapp: `54915${dniSuffix}`,
        passwordHash,
        role: 'USER',
        status: 'BANNED',
      },
    });
    bannedUserId = banned.id;

    // One prediction against the FINISHED match (must appear).
    await prisma.prediction.create({
      data: {
        userId,
        matchId: finishedMatchId,
        scoreHome: 2,
        scoreAway: 1,
        outcomeType: 'EXACT',
        basePoints: 5,
        multiplier: 1,
        pointsEarned: 5,
        evaluatedAt: new Date(),
      },
    });
    // One prediction against the SCHEDULED match (must NOT appear).
    await prisma.prediction.create({
      data: {
        userId,
        matchId: scheduledMatchId,
        scoreHome: 1,
        scoreAway: 0,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.prediction.deleteMany({
        where: {
          userId: { in: [userId, bannedUserId].filter(Boolean) as string[] },
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [userId, bannedUserId].filter(Boolean) as string[] },
        },
      });
      await prisma.match.deleteMany({
        where: { id: { in: [finishedMatchId, scheduledMatchId] } },
      });
    }
    if (app) await app.close();
  });

  it('returns the user with FINISHED predictions only — no auth required', async () => {
    const res = await request(app.getHttpServer()).get(
      `/users/${userId}/public-profile`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: userId,
      firstName: 'Public',
      lastName: 'Profile',
    });
    expect(Array.isArray(res.body.predictionsFinished)).toBe(true);

    // The SCHEDULED-match prediction must be filtered out.
    const matchIds: string[] = res.body.predictionsFinished.map(
      (p: { matchId: string }) => p.matchId,
    );
    expect(matchIds).toContain(finishedMatchId);
    expect(matchIds).not.toContain(scheduledMatchId);

    // FINISHED-match row carries all expected fields.
    const fin = res.body.predictionsFinished.find(
      (p: { matchId: string }) => p.matchId === finishedMatchId,
    );
    expect(fin).toEqual(
      expect.objectContaining({
        scoreHome: 2,
        scoreAway: 1,
        outcomeType: 'EXACT',
        pointsEarned: 5,
      }),
    );
    expect(fin.match).toEqual(
      expect.objectContaining({
        id: finishedMatchId,
        phase: 'GROUPS',
        scoreHome: 2,
        scoreAway: 1,
      }),
    );
    expect(fin.match.homeTeam).toMatchObject({ fifaCode: expect.any(String) });
  });

  it('NEVER leaks dni, whatsapp, role, status, or other sensitive User fields', async () => {
    const res = await request(app.getHttpServer()).get(
      `/users/${userId}/public-profile`,
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('dni');
    expect(res.body).not.toHaveProperty('whatsapp');
    expect(res.body).not.toHaveProperty('role');
    expect(res.body).not.toHaveProperty('status');
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('returns 404 for an unknown user id', async () => {
    const res = await request(app.getHttpServer()).get(
      '/users/clxx_does_not_exist/public-profile',
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for a BANNED user (does not acknowledge they exist)', async () => {
    const res = await request(app.getHttpServer()).get(
      `/users/${bannedUserId}/public-profile`,
    );
    expect(res.status).toBe(404);
  });
});
