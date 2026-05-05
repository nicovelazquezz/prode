import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP integration tests for `/leagues` (Phase 10 tasks 10.2). Boots the
 * full Nest app (auth guards, validation pipe, real Postgres) and walks
 * the create + list flows. Joining via invite code + per-league
 * leaderboard live in their own files for tasks 10.3 / 10.4.
 */
describe('LeaguesController (integration — create + list)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;
  let userId: string;
  let secondUserToken: string;
  let secondUserId: string;
  const createdLeagueIds: string[] = [];

  // Random stamp keeps DNI / WhatsApp / league-name uniqueness clean
  // across re-runs.
  const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
  const userDni = String(81_000_000 + stamp).slice(-8);
  const secondDni = String(82_000_000 + stamp).slice(-8);
  const password = 'Lg_Ctrl_Test!1';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        dni: userDni,
        firstName: 'Lg',
        lastName: 'Owner',
        whatsapp: `549${String(8_100_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
      },
    });
    userId = user.id;
    // Multi-prode: leagues are owned by users but membership is by entry.
    // Both users need an Entry #1 so they can create / join leagues.
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
    await prisma.entry.create({
      data: {
        userId: user.id,
        paymentId: userPayment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });
    const secondUser = await prisma.user.create({
      data: {
        dni: secondDni,
        firstName: 'Lg',
        lastName: 'Other',
        whatsapp: `549${String(8_200_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
      },
    });
    secondUserId = secondUser.id;
    const secondPayment = await prisma.payment.create({
      data: {
        userId: secondUser.id,
        amount: 10_000,
        method: 'CASH',
        status: 'APPROVED',
        paidAt: new Date(),
        completedAt: new Date(),
      },
    });
    await prisma.entry.create({
      data: {
        userId: secondUser.id,
        paymentId: secondPayment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });

    const userLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: userDni, password });
    expect(userLogin.status).toBe(200);
    userToken = userLogin.body.accessToken;

    const secondLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: secondDni, password });
    expect(secondLogin.status).toBe(200);
    secondUserToken = secondLogin.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    if (!prisma) {
      if (app) await app.close();
      return;
    }
    for (const id of createdLeagueIds) {
      await prisma.leagueMembership.deleteMany({ where: { leagueId: id } });
      await prisma.league.delete({ where: { id } }).catch(() => undefined);
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    if (secondUserId) {
      await prisma.user.delete({ where: { id: secondUserId } }).catch(() => undefined);
    }
    if (app) await app.close();
  }, 30_000);

  it('POST /leagues requires authentication', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues')
      .send({ name: 'Anon-Liga' });
    expect(res.status).toBe(401);
  });

  it('POST /leagues creates a league with a 6-char invite code and auto-adds the owner', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: `Liga-A-${stamp}`,
        description: 'Mi liga de prueba',
        isPublic: false,
        maxMembers: 10,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.ownerId).toBe(userId);
    expect(res.body.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(res.body.maxMembers).toBe(10);
    expect(res.body.isPublic).toBe(false);
    createdLeagueIds.push(res.body.id);

    // Owner membership row materialised — keyed by entry now.
    const membership = await prisma.leagueMembership.findFirst({
      where: { leagueId: res.body.id, entry: { userId } },
    });
    expect(membership).not.toBeNull();
  });

  it('POST /leagues rejects too-short names', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'ab' });
    expect(res.status).toBe(400);
  });

  it('POST /leagues rejects maxMembers below 2', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: `Liga-MaxMin-${stamp}`, maxMembers: 1 });
    expect(res.status).toBe(400);
  });

  it('POST /leagues defaults maxMembers to 50 when omitted', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: `Liga-Default-${stamp}` });
    expect(res.status).toBe(201);
    expect(res.body.maxMembers).toBe(50);
    createdLeagueIds.push(res.body.id);
  });

  it('GET /leagues/me requires authentication', async () => {
    const res = await request(app.getHttpServer()).get('/leagues/me');
    expect(res.status).toBe(401);
  });

  it('GET /leagues/me returns only leagues the caller is a member of', async () => {
    // Owner sees both leagues created above.
    const ownerRes = await request(app.getHttpServer())
      .get('/leagues/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(ownerRes.status).toBe(200);
    expect(Array.isArray(ownerRes.body)).toBe(true);
    const ownerIds = ownerRes.body.map((l: { id: string }) => l.id);
    for (const id of createdLeagueIds) {
      expect(ownerIds).toContain(id);
    }
    // Each entry carries memberCount + isOwner flags.
    for (const entry of ownerRes.body) {
      expect(typeof entry.memberCount).toBe('number');
      expect(typeof entry.isOwner).toBe('boolean');
      if (createdLeagueIds.includes(entry.id)) {
        expect(entry.isOwner).toBe(true);
        expect(entry.memberCount).toBeGreaterThanOrEqual(1);
      }
    }

    // The non-member user gets none of these leagues back.
    const otherRes = await request(app.getHttpServer())
      .get('/leagues/me')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(otherRes.status).toBe(200);
    const otherIds = otherRes.body.map((l: { id: string }) => l.id);
    for (const id of createdLeagueIds) {
      expect(otherIds).not.toContain(id);
    }
  });
});
