import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP integration tests for `/leaderboard/*` endpoints. Boots the full
 * Nest app (auth guards, validation pipe, real Postgres + Redis) and
 * exercises the public + authenticated paths.
 */
describe('LeaderboardController (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;
  let adminToken: string;
  let userId: string;
  let leagueId: string | null = null;
  // Stamp keeps unique constraints (DNI, whatsapp, invite code) clean
  // across re-runs.
  const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
  const memberDni = String(80_000_000 + stamp).slice(-8);
  const memberPassword = 'Lb_Ctrl_Test!1';

  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    // Refresh MV so the global ladder has data for the public reads.
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global`;

    // Admin login (for the league owner — admins can also exercise auth
    // routes the same way regular users do).
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    if (adminLogin.status !== 200) {
      throw new Error(
        `Admin login failed (status ${adminLogin.status}). Run Phase 2 seed.`,
      );
    }
    adminToken = adminLogin.body.accessToken;

    // Create a regular user (we need a real password hash — the easiest
    // path is to register through the auth service so the bcrypt round
    // matches what login expects).
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(memberPassword, 10);
    const user = await prisma.user.create({
      data: {
        dni: memberDni,
        firstName: 'Lb',
        lastName: 'Ctrl',
        whatsapp: `549${String(8_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
      },
    });
    userId = user.id;
    // Multi-prode: regular user gets a Payment + Entry #1.
    const userPayment = await prisma.payment.create({
      data: {
        userId: user.id,
        amount: 10_000,
        method: 'CASH',
        status: 'APPROVED',
        paidAt: new Date(),
        completedAt: new Date(),
      },
    });
    const userEntry = await prisma.entry.create({
      data: {
        userId: user.id,
        paymentId: userPayment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });

    const userLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: memberDni, password: memberPassword });
    expect(userLogin.status).toBe(200);
    userToken = userLogin.body.accessToken;

    // League: admin owns it, user is a member. Both need entries; admin
    // probably doesn't have one in the seed, so create one for them too.
    const adminUser = await prisma.user.findFirstOrThrow({ where: { dni: ADMIN_DNI } });
    let adminEntry = await prisma.entry.findFirst({
      where: { userId: adminUser.id, status: 'ACTIVE' },
      orderBy: { position: 'asc' },
    });
    if (!adminEntry) {
      const adminPayment = await prisma.payment.create({
        data: {
          userId: adminUser.id,
          amount: 10_000,
          method: 'CASH',
          status: 'APPROVED',
          paidAt: new Date(),
          completedAt: new Date(),
        },
      });
      adminEntry = await prisma.entry.create({
        data: {
          userId: adminUser.id,
          paymentId: adminPayment.id,
          position: 1,
          status: 'ACTIVE',
        },
      });
    }
    const league = await prisma.league.create({
      data: {
        name: `Lb-Ctrl-${stamp}`,
        inviteCode: `LBC${stamp}`.slice(0, 16),
        ownerId: adminUser.id,
        members: {
          create: [{ entryId: adminEntry.id }, { entryId: userEntry.id }],
        },
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
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    if (app) await app.close();
  }, 30_000);

  // ── /leaderboard/global ────────────────────────────────────────────

  it('GET /leaderboard/global is public and returns { rows, total }', async () => {
    const res = await request(app.getHttpServer()).get('/leaderboard/global');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('GET /leaderboard/global rejects pageSize > 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/leaderboard/global')
      .query({ pageSize: 999 });
    expect(res.status).toBe(400);
  });

  // ── /leaderboard/phase/:phase ──────────────────────────────────────

  it('GET /leaderboard/phase/GROUPS is public', async () => {
    const res = await request(app.getHttpServer()).get('/leaderboard/phase/GROUPS');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('GET /leaderboard/phase/UNKNOWN returns 400', async () => {
    const res = await request(app.getHttpServer()).get('/leaderboard/phase/UNKNOWN');
    expect(res.status).toBe(400);
  });

  // ── /leaderboard/me/around ─────────────────────────────────────────

  it('GET /leaderboard/me/around requires authentication', async () => {
    const res = await request(app.getHttpServer()).get('/leaderboard/me/around');
    expect(res.status).toBe(401);
  });

  it('GET /leaderboard/me/around returns the caller-centred slice', async () => {
    const res = await request(app.getHttpServer())
      .get('/leaderboard/me/around')
      .set('Authorization', `Bearer ${userToken}`)
      .query({ n: 3 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  // ── /leaderboard/league/:leagueId ──────────────────────────────────

  it('GET /leaderboard/league/:leagueId requires authentication', async () => {
    const res = await request(app.getHttpServer()).get(
      `/leaderboard/league/${leagueId}`,
    );
    expect(res.status).toBe(401);
  });

  it('GET /leaderboard/league/:leagueId returns 403 for non-members', async () => {
    // Spin up a temp user who is NOT a member.
    const stamp2 = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
    const dni = String(85_000_000 + stamp2).slice(-8);
    const password = 'NonMember_Test!1';
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(password, 10);
    const outsider = await prisma.user.create({
      data: {
        dni,
        firstName: 'Lb',
        lastName: 'Outsider',
        whatsapp: `549${String(8_500_000_000 + stamp2).slice(-9)}`.slice(0, 13),
        passwordHash: hash,
      },
    });
    try {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ dni, password });
      expect(login.status).toBe(200);
      const outsiderToken = login.body.accessToken;

      const res = await request(app.getHttpServer())
        .get(`/leaderboard/league/${leagueId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    } finally {
      await prisma.user.delete({ where: { id: outsider.id } }).catch(() => undefined);
    }
  });

  it('GET /leaderboard/league/:leagueId returns the ladder for a member', async () => {
    const res = await request(app.getHttpServer())
      .get(`/leaderboard/league/${leagueId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    // Total may be 0 or 2 depending on whether the freshly-created
    // members landed in the MV (they were created but the MV refresh
    // ran before — admin is in the seed data, so we expect at least 1).
    expect(typeof res.body.total).toBe('number');
  });

  it('GET /leaderboard/league/:leagueId returns 403 for an unknown leagueId', async () => {
    // No membership → 403 (we don't leak existence in the response).
    const res = await request(app.getHttpServer())
      .get('/leaderboard/league/does-not-exist')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  // ADMIN role does NOT bypass membership — the spec scopes the league
  // ladder to actual members, even for admins. Sanity-check that path.
  it('admin without membership still hits 403', async () => {
    // Admin user from seed is the owner of `leagueId`, which means they
    // ARE a member. Use a different fake leagueId to assert the membership
    // gate fires regardless of role.
    const res = await request(app.getHttpServer())
      .get('/leaderboard/league/some-other-league-id')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });
});
