import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP integration tests for `GET /leagues/:leagueId/leaderboard`
 * (Phase 10 task 10.4). Reuses LeaderboardService.getByLeague under
 * the hood — the focus here is the membership-gate behaviour layered
 * on top.
 */
describe('LeaguesController leaderboard (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let memberToken: string;
  let outsiderToken: string;
  let memberId: string;
  let outsiderId: string;
  let leagueId: string | null = null;

  const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
  const memberDni = String(86_000_000 + stamp).slice(-8);
  const outsiderDni = String(87_000_000 + stamp).slice(-8);
  const password = 'Lg_Lb_Test!1';

  async function createUser(dni: string, suffix: string, waPrefix: number) {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(password, 10);
    return prisma.user.create({
      data: {
        dni,
        firstName: `Lg-${suffix}`,
        lastName: 'Lb',
        whatsapp: `549${String(waPrefix + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
      },
    });
  }

  async function loginAccessToken(dni: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    // Refresh MV so the underlying service can find rows for the
    // member; in a fresh test DB the count may be 0 but the call still
    // succeeds.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;

    const member = await createUser(memberDni, 'Member', 8_600_000_000);
    memberId = member.id;
    const outsider = await createUser(outsiderDni, 'Outsider', 8_700_000_000);
    outsiderId = outsider.id;

    memberToken = await loginAccessToken(memberDni);
    outsiderToken = await loginAccessToken(outsiderDni);

    // League is owned by `member`; member is the only seeded
    // membership row at the start.
    const league = await prisma.league.create({
      data: {
        name: `Liga-Lb-${stamp}`,
        inviteCode: `LBL${String(stamp)}`.slice(0, 6).padEnd(6, 'A'),
        ownerId: memberId,
        members: { create: { userId: memberId } },
      },
    });
    leagueId = league.id;
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
    for (const userId of [memberId, outsiderId]) {
      if (userId) {
        await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      }
    }
    if (app) await app.close();
  }, 30_000);

  it('GET /leagues/:id/leaderboard requires authentication', async () => {
    const res = await request(app.getHttpServer()).get(
      `/leagues/${leagueId}/leaderboard`,
    );
    expect(res.status).toBe(401);
  });

  it('GET /leagues/:id/leaderboard returns 403 for non-members', async () => {
    const res = await request(app.getHttpServer())
      .get(`/leagues/${leagueId}/leaderboard`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /leagues/:id/leaderboard returns 403 for unknown league ids', async () => {
    // Same shape as "league exists but you are not a member" — the
    // server intentionally does not leak existence.
    const res = await request(app.getHttpServer())
      .get('/leagues/does-not-exist-id/leaderboard')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /leagues/:id/leaderboard returns the ladder for a member', async () => {
    const res = await request(app.getHttpServer())
      .get(`/leagues/${leagueId}/leaderboard`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('GET /leagues/:id/leaderboard honours pagination params', async () => {
    const res = await request(app.getHttpServer())
      .get(`/leagues/${leagueId}/leaderboard`)
      .set('Authorization', `Bearer ${memberToken}`)
      .query({ page: 1, pageSize: 5 });
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeLessThanOrEqual(5);
  });

  it('GET /leagues/:id/leaderboard rejects pageSize > 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/leagues/${leagueId}/leaderboard`)
      .set('Authorization', `Bearer ${memberToken}`)
      .query({ pageSize: 999 });
    expect(res.status).toBe(400);
  });
});
