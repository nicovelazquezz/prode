import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Integration tests for the `PredictionsController` (Phase 7 Task 7.2).
 *
 * Strategy: create a throwaway USER directly in the DB with a known bcrypt
 * hash so we can `POST /auth/login` to mint a real JWT (the global
 * `JwtAuthGuard` accepts no shortcut otherwise). Pick a couple of seeded
 * matches to play with, and snapshot one of them so we can flip its
 * `predictionsLockAt` into the past for the lock-window assertion.
 */
describe('PredictionsController (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Throwaway user + JWT minted at boot.
  let userId: string;
  let userToken: string;

  // Matches we'll mutate. Each one is restored on teardown.
  let matchOpenId: string;
  let matchOpen2Id: string;
  let matchLockedId: string;
  let originalLock: Date;

  // Per-suite secret + DNI/whatsapp pairs anchored on Date.now() so re-runs
  // don't trip the unique constraints on a sticky DB.
  const PASSWORD = 'pred-test-pass!';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const stamp = Date.now() % 90_000_000;
    const dni = String(10_000_000 + stamp).slice(-8);
    const whatsapp = `549${String(1_000_000_000 + stamp).slice(-9)}`.slice(
      0,
      13,
    );
    const passwordHash = await bcrypt.hash(PASSWORD, 4); // 4 rounds = fast for tests

    const user = await prisma.user.create({
      data: {
        dni,
        firstName: 'Ctrl',
        lastName: 'Tester',
        whatsapp,
        passwordHash,
      },
    });
    userId = user.id;
    // Multi-prode: every paying user has an Entry — controller resolves
    // the primary entry on /predictions/... so we need one too.
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
      throw new Error(`Test setup failed: login returned ${login.status}`);
    }
    userToken = login.body.accessToken;

    // Pick three matches deterministically. matchNumber 80/81/82 are deep
    // enough into the seed to avoid clashing with the matches the Phase 6
    // suite mutates (50..62).
    const open = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 80 },
    });
    const open2 = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 81 },
    });
    const locked = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 82 },
    });
    matchOpenId = open.id;
    matchOpen2Id = open2.id;
    matchLockedId = locked.id;
    originalLock = locked.predictionsLockAt;

    await prisma.match.update({
      where: { id: matchLockedId },
      data: { predictionsLockAt: new Date(Date.now() - 60_000) },
    });
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Predictions cascade from Entry → User; deleting the user
      // unwinds the entry/predictions tree via FK CASCADE.
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      if (matchLockedId && originalLock) {
        await prisma.match.update({
          where: { id: matchLockedId },
          data: { predictionsLockAt: originalLock },
        });
      }
    }
    if (app) await app.close();
  }, 30_000);

  describe('POST /predictions/match/:matchId', () => {
    it('rejects requests with no auth (401)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/predictions/match/${matchOpenId}`)
        .send({ scoreHome: 1, scoreAway: 0 });
      expect(res.status).toBe(401);
    });

    it('creates a prediction for the authenticated user (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/predictions/match/${matchOpenId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ scoreHome: 3, scoreAway: 2 });
      expect(res.status).toBe(201);
      expect(res.body.scoreHome).toBe(3);
      expect(res.body.scoreAway).toBe(2);
      expect(res.body.matchId).toBe(matchOpenId);
      // Multi-prode: response carries entryId now (the controller
      // resolves the user's primary entry).
      expect(res.body.entryId).toBeDefined();
    });

    it('rejects invalid scores via the DTO (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/predictions/match/${matchOpenId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ scoreHome: -1, scoreAway: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects scores above 99 via the DTO (400)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/predictions/match/${matchOpenId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ scoreHome: 0, scoreAway: 200 });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown match', async () => {
      const res = await request(app.getHttpServer())
        .post(`/predictions/match/non-existent-match`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ scoreHome: 1, scoreAway: 1 });
      expect(res.status).toBe(404);
    });

    it('returns 400 PREDICTION_LOCKED past lock', async () => {
      const res = await request(app.getHttpServer())
        .post(`/predictions/match/${matchLockedId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ scoreHome: 0, scoreAway: 0 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PREDICTION_LOCKED');
    });
  });

  describe('PUT /predictions/match/:matchId', () => {
    it('updates an existing prediction (idempotent upsert)', async () => {
      // The POST test above already wrote a prediction for matchOpenId.
      const res = await request(app.getHttpServer())
        .put(`/predictions/match/${matchOpenId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ scoreHome: 0, scoreAway: 5 });
      expect(res.status).toBe(200);
      expect(res.body.scoreHome).toBe(0);
      expect(res.body.scoreAway).toBe(5);

      // Find via entry — the user's primary entry is the one the
      // controller resolves to.
      const entry = await prisma.entry.findFirstOrThrow({
        where: { userId, status: 'ACTIVE' },
        orderBy: { position: 'asc' },
      });
      const inDb = await prisma.prediction.findUniqueOrThrow({
        where: { entryId_matchId: { entryId: entry.id, matchId: matchOpenId } },
      });
      expect(inDb.scoreHome).toBe(0);
      expect(inDb.scoreAway).toBe(5);
    });

    it('also creates if no row existed yet (PUT == POST in idempotent flow)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/predictions/match/${matchOpen2Id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ scoreHome: 1, scoreAway: 1 });
      expect(res.status).toBe(200);
      expect(res.body.matchId).toBe(matchOpen2Id);
    });
  });

  describe('GET /predictions/me', () => {
    it('returns the user\'s predictions with match relations populated', async () => {
      const res = await request(app.getHttpServer())
        .get('/predictions/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      for (const row of res.body.data as Array<{
        matchId: string;
        match: { homeTeam: unknown; awayTeam: unknown; phase: string };
      }>) {
        expect(row.match).toBeDefined();
        expect(row.match).toHaveProperty('homeTeam');
        expect(row.match).toHaveProperty('awayTeam');
      }
    });

    it('paginates with page/pageSize', async () => {
      const res = await request(app.getHttpServer())
        .get('/predictions/me')
        .query({ page: 1, pageSize: 1 })
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pageSize).toBe(1);
    });

    it('filters by phase', async () => {
      const res = await request(app.getHttpServer())
        .get('/predictions/me')
        .query({ phase: 'GROUPS' })
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      for (const row of res.body.data as Array<{ match: { phase: string } }>) {
        expect(row.match.phase).toBe('GROUPS');
      }
    });

    it('rejects unknown phase via DTO whitelist (400)', async () => {
      const res = await request(app.getHttpServer())
        .get('/predictions/me')
        .query({ phase: 'NOT_A_PHASE' })
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /predictions/me/match/:matchId', () => {
    it('returns the prediction when it exists', async () => {
      const res = await request(app.getHttpServer())
        .get(`/predictions/me/match/${matchOpenId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body).not.toBeNull();
      expect(res.body.matchId).toBe(matchOpenId);
      expect(res.body.match).toBeDefined();
    });

    it('returns null when the user has no prediction for that match', async () => {
      // Use the locked match — the user never wrote a prediction for it.
      const res = await request(app.getHttpServer())
        .get(`/predictions/me/match/${matchLockedId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });
});
