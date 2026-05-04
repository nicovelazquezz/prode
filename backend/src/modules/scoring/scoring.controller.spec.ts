import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP-level integration tests for `POST /admin/matches/:id/finish`.
 *
 * Bootstraps the full Nest app, logs in as the seeded admin, picks an
 * unused match (matchNumber=61 — chosen to not collide with the
 * scoring.service.integration.spec which uses 60 or the predictions
 * suite that uses 70/71), and exercises the success + 4xx paths.
 *
 * Cleanup: snapshot the match before each test, restore on teardown,
 * delete generated audit rows.
 */
describe('POST /admin/matches/:id/finish (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let matchId: string;
  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    if (login.status !== 200) {
      throw new Error(
        `Admin login failed (status ${login.status}). Run Phase 2 seed.`,
      );
    }
    adminToken = login.body.accessToken;

    const match = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 61 },
    });
    matchId = match.id;
  }, 30_000);

  afterAll(async () => {
    if (prisma && matchId) {
      await prisma.prediction.deleteMany({ where: { matchId } });
      await prisma.auditLog.deleteMany({
        where: { entity: 'match', entityId: matchId },
      });
      await prisma.match.update({
        where: { id: matchId },
        data: {
          status: 'SCHEDULED',
          scoreHome: null,
          scoreAway: null,
          finishedAt: null,
        },
      });
    }
    if (app) await app.close();
  }, 30_000);

  beforeEach(async () => {
    // Force the row back to a finishable state so each test starts clean.
    await prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'SCHEDULED',
        scoreHome: null,
        scoreAway: null,
        finishedAt: null,
      },
    });
    await prisma.auditLog.deleteMany({
      where: { entity: 'match', entityId: matchId },
    });
  });

  it('rejects non-admin requests', async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/matches/${matchId}/finish`)
      .send({ scoreHome: 2, scoreAway: 1 });
    // No JWT → JwtAuthGuard returns 401.
    expect(res.status).toBe(401);
  });

  it('rejects bad payloads with 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/matches/${matchId}/finish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: -1, scoreAway: 1 });
    expect(res.status).toBe(400);
  });

  it('finishes the match and returns the updated row', async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/matches/${matchId}/finish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 2, scoreAway: 1 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FINISHED');
    expect(res.body.scoreHome).toBe(2);
    expect(res.body.scoreAway).toBe(1);
  });

  it('returns 400 MATCH_ALREADY_FINISHED on second call', async () => {
    // First call → FINISHED.
    const first = await request(app.getHttpServer())
      .post(`/admin/matches/${matchId}/finish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 1, scoreAway: 0 });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post(`/admin/matches/${matchId}/finish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scoreHome: 9, scoreAway: 9 });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('MATCH_ALREADY_FINISHED');
  });

  it('returns 409 PHASE_ALREADY_PAID when phase prize already paid', async () => {
    // Create a PAID PhaseWinner for GROUPS first.
    const seededUser = await prisma.user.findFirstOrThrow({
      where: { dni: ADMIN_DNI },
    });
    await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });
    await prisma.phaseWinner.create({
      data: {
        phase: 'GROUPS',
        userId: seededUser.id,
        pointsEarned: 100,
        prizeStatus: 'PAID',
      },
    });

    try {
      const res = await request(app.getHttpServer())
        .post(`/admin/matches/${matchId}/finish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ scoreHome: 1, scoreAway: 0 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_ALREADY_PAID');
    } finally {
      await prisma.phaseWinner.deleteMany({ where: { phase: 'GROUPS' } });
    }
  });
});
