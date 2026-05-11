import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP integration tests for `POST /leagues/join` (Phase 10 task 10.3).
 * Exercises the four documented branches: 404 unknown code, 409 league
 * full, 409 already member, 201 happy path.
 */
describe('LeaguesController join (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let joinerToken: string;
  let outsiderToken: string;
  let ownerId: string;
  let joinerId: string;
  let outsiderId: string;
  const createdLeagueIds: string[] = [];

  const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
  const ownerDni = String(83_000_000 + stamp).slice(-8);
  const joinerDni = String(84_000_000 + stamp).slice(-8);
  const outsiderDni = String(85_000_000 + stamp).slice(-8);
  const password = 'Lg_Join_Test!1';

  async function createUser(dni: string, suffix: string, waPrefix: number) {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        dni,
        firstName: `Lg-${suffix}`,
        lastName: 'Join',
        whatsapp: `549${String(waPrefix + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
      },
    });
    // Multi-prode: create Entry #1 so the user can create / join leagues.
    const payment = await prisma.payment.create({
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
        paymentId: payment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });
    return user;
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

    const owner = await createUser(ownerDni, 'Owner', 8_300_000_000);
    ownerId = owner.id;
    const joiner = await createUser(joinerDni, 'Joiner', 8_400_000_000);
    joinerId = joiner.id;
    const outsider = await createUser(outsiderDni, 'Outsider', 8_500_000_000);
    outsiderId = outsider.id;

    ownerToken = await loginAccessToken(ownerDni);
    joinerToken = await loginAccessToken(joinerDni);
    outsiderToken = await loginAccessToken(outsiderDni);
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
    for (const userId of [ownerId, joinerId, outsiderId]) {
      if (userId) {
        await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      }
    }
    if (app) await app.close();
  }, 30_000);

  /**
   * Helper: creates a league as `ownerToken` with a custom maxMembers,
   * tracks the id for cleanup, and returns the inviteCode from the
   * response body.
   */
  async function createLeagueAsOwner(opts: {
    name: string;
    maxMembers?: number;
  }): Promise<{ id: string; inviteCode: string }> {
    const res = await request(app.getHttpServer())
      .post('/leagues')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: opts.name, maxMembers: opts.maxMembers ?? 50 });
    expect(res.status).toBe(201);
    createdLeagueIds.push(res.body.id);
    return { id: res.body.id, inviteCode: res.body.inviteCode };
  }

  it('POST /leagues/join requires authentication', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues/join')
      .send({ inviteCode: 'ABC234' });
    expect(res.status).toBe(401);
  });

  it('POST /leagues/join rejects malformed invite codes', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ inviteCode: '0OIL11' }); // contains banned glyphs + wrong shape
    expect(res.status).toBe(400);
  });

  it('POST /leagues/join returns 404 for an unknown invite code', async () => {
    const res = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${joinerToken}`)
      // Valid shape, almost certainly not in the DB.
      .send({ inviteCode: 'ZZZZZZ' });
    expect(res.status).toBe(404);
  });

  it('POST /leagues/join joins successfully with a valid code', async () => {
    const { id, inviteCode } = await createLeagueAsOwner({
      name: `Liga-Join-${stamp}`,
    });

    const res = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ inviteCode });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(id);
    expect(res.body.inviteCode).toBe(inviteCode);

    const membership = await prisma.leagueMembership.findFirst({
      where: { leagueId: id, entry: { userId: joinerId } },
    });
    expect(membership).not.toBeNull();
  });

  it('POST /leagues/join lower-cases input — case-insensitive lookup', async () => {
    const { inviteCode } = await createLeagueAsOwner({
      name: `Liga-Case-${stamp}`,
    });

    const res = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ inviteCode: inviteCode.toLowerCase() });
    // 201 = the DTO transform upper-cased the code before lookup.
    expect(res.status).toBe(201);
  });

  it('POST /leagues/join returns 409 when the user is already a member', async () => {
    const { inviteCode } = await createLeagueAsOwner({
      name: `Liga-Dup-${stamp}`,
    });

    const first = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ inviteCode });
    expect(first.status).toBe(201);

    const dup = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ inviteCode });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ALREADY_LEAGUE_MEMBER');
  });

  it('POST /leagues/join returns 409 when the league is full', async () => {
    // maxMembers = 2 — owner takes one slot, the joiner takes the
    // second. The outsider can no longer fit.
    const { inviteCode } = await createLeagueAsOwner({
      name: `Liga-Full-${stamp}`,
      maxMembers: 2,
    });

    const fillRes = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ inviteCode });
    expect(fillRes.status).toBe(201);

    const fullRes = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ inviteCode });
    expect(fullRes.status).toBe(409);
    expect(fullRes.body.code).toBe('LEAGUE_FULL');
  });

  it('POST /leagues/join lets the owner-as-member case still 409 (already member)', async () => {
    // Sanity: the owner is auto-added on create, so trying to "join"
    // their own league via the invite code 409s with ALREADY_LEAGUE_MEMBER.
    const { inviteCode } = await createLeagueAsOwner({
      name: `Liga-Self-${stamp}`,
    });

    const res = await request(app.getHttpServer())
      .post('/leagues/join')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ inviteCode });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_LEAGUE_MEMBER');
  });
});
