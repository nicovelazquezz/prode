import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Integration tests for the special-prediction endpoints (Task 7.3).
 *
 * Same pattern as `predictions.controller.spec.ts`: spin up the full app,
 * mint a real JWT for a throwaway user, and exercise:
 *   - happy path create + update
 *   - cross-field validation (champion ≠ runnerUp ≠ third)
 *   - lockedAt enforcement (we set lockedAt manually to simulate the cron)
 *   - GET /predictions/special/me returns the row or null
 */
describe('SpecialPredictions endpoints (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;
  let userToken: string;

  // Two distinct teams pulled from the seed (any two will do).
  let teamAId: string;
  let teamBId: string;
  let teamCId: string;

  const PASSWORD = 'special-test-pass!';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const stamp = (Date.now() + 1) % 90_000_000; // +1 to avoid clash with other suite
    const dni = String(20_000_000 + stamp).slice(-8);
    const whatsapp = `549${String(2_000_000_000 + stamp).slice(-9)}`.slice(
      0,
      13,
    );
    const passwordHash = await bcrypt.hash(PASSWORD, 4);

    const user = await prisma.user.create({
      data: {
        dni,
        firstName: 'Special',
        lastName: 'Picker',
        whatsapp,
        passwordHash,
      },
    });
    userId = user.id;
    // Multi-prode: every payer has Entry #1.
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

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password: PASSWORD });
    if (login.status !== 200) {
      throw new Error(
        `Test setup failed: login returned ${login.status} body=${JSON.stringify(login.body)}`,
      );
    }
    userToken = login.body.accessToken;

    const teams = await prisma.team.findMany({
      take: 3,
      orderBy: { name: 'asc' },
    });
    if (teams.length < 3) {
      throw new Error('Test prerequisite: need ≥3 teams in DB');
    }
    teamAId = teams[0]!.id;
    teamBId = teams[1]!.id;
    teamCId = teams[2]!.id;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Special predictions cascade off entries; deleting the user
      // wipes the entry → specialPrediction tree.
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    if (app) await app.close();
  }, 30_000);

  describe('GET /predictions/special/me', () => {
    it('returns null when no row exists yet', async () => {
      const res = await request(app.getHttpServer())
        .get('/predictions/special/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      // Nest serialises null as an empty body; supertest exposes it as {}.
      expect(res.body).toEqual({});
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app.getHttpServer()).get(
        '/predictions/special/me',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('POST /predictions/special', () => {
    it('creates a special prediction (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/predictions/special')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          championTeamId: teamAId,
          runnerUpTeamId: teamBId,
          thirdPlaceTeamId: teamCId,
          topScorerName: 'Lionel Messi',
          totalGoals: 145,
        });
      expect(res.status).toBe(201);
      // Multi-prode: special predictions are keyed by entryId now.
      expect(res.body.entryId).toBeDefined();
      expect(res.body.championTeamId).toBe(teamAId);
      expect(res.body.runnerUpTeamId).toBe(teamBId);
      expect(res.body.thirdPlaceTeamId).toBe(teamCId);
      expect(res.body.topScorerName).toBe('Lionel Messi');
      expect(res.body.totalGoals).toBe(145);
      expect(res.body.lockedAt).toBeNull();
    });

    it('rejects when champion === runnerUp (400)', async () => {
      const res = await request(app.getHttpServer())
        .put('/predictions/special')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          championTeamId: teamAId,
          runnerUpTeamId: teamAId,
        });
      expect(res.status).toBe(400);
    });

    it('rejects when champion === third (400)', async () => {
      const res = await request(app.getHttpServer())
        .put('/predictions/special')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          championTeamId: teamAId,
          thirdPlaceTeamId: teamAId,
        });
      expect(res.status).toBe(400);
    });

    it('rejects totalGoals = 0 (400)', async () => {
      const res = await request(app.getHttpServer())
        .put('/predictions/special')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ totalGoals: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects totalGoals > 500 via DTO (400)', async () => {
      const res = await request(app.getHttpServer())
        .put('/predictions/special')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ totalGoals: 9999 });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /predictions/special', () => {
    it('updates the existing prediction', async () => {
      const res = await request(app.getHttpServer())
        .put('/predictions/special')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ totalGoals: 160 });
      expect(res.status).toBe(200);
      expect(res.body.totalGoals).toBe(160);
      // Champion still set from previous POST.
      expect(res.body.championTeamId).toBe(teamAId);
    });

    it('rejects when lockedAt is set (SPECIAL_PREDICTION_LOCKED)', async () => {
      // Simulate the cron from spec 5.3. Multi-prode: keyed by entryId.
      const entry = await prisma.entry.findFirstOrThrow({
        where: { userId, status: 'ACTIVE' },
        orderBy: { position: 'asc' },
      });
      await prisma.specialPrediction.update({
        where: { entryId: entry.id },
        data: { lockedAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .put('/predictions/special')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ totalGoals: 200 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SPECIAL_PREDICTION_LOCKED');

      // Restore lockedAt for the GET test below.
      await prisma.specialPrediction.update({
        where: { entryId: entry.id },
        data: { lockedAt: null },
      });
    });
  });

  describe('GET /predictions/special/me (after writes)', () => {
    it('returns the row with team relations populated', async () => {
      const res = await request(app.getHttpServer())
        .get('/predictions/special/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body.championTeam).toBeDefined();
      expect(res.body.championTeam.id).toBe(teamAId);
      expect(res.body.runnerUpTeam.id).toBe(teamBId);
      expect(res.body.thirdPlaceTeam.id).toBe(teamCId);
    });
  });
});
