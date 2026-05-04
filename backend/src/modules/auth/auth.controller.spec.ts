import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Integration test against the real Postgres instance running in
 * docker-compose. Relies on Phase 2 seeds: admin user with DNI `00000000`
 * and password `ADMIN_DEFAULT_PASSWORD` from .env.
 *
 * Skipped automatically if `DATABASE_URL` is not reachable (e.g. CI
 * without the docker stack up).
 */
describe('POST /auth/login (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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

    // Sanity check: the admin user must exist (seeded in Phase 2).
    const admin = await prisma.user.findUnique({ where: { dni: ADMIN_DNI } });
    if (!admin) {
      throw new Error(
        `Test prerequisite failed: admin user with DNI ${ADMIN_DNI} not found. Run Phase 2 seed.`,
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns 200 + accessToken + refresh cookie for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      dni: ADMIN_DNI,
      role: 'ADMIN',
    });
    // Cookie must be httpOnly and contain the refresh token.
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : ([setCookie] as string[]);
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));
    expect(refresh).toBeDefined();
    expect(refresh).toMatch(/HttpOnly/i);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: 'definitely-not-the-right-one' });

    expect(res.status).toBe(401);
  });

  it('returns 401 for non-existent DNI', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: '99999999', password: 'whatever' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when dni does not match the regex', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: 'abc', password: 'whatever' });

    expect(res.status).toBe(400);
  });

  it('writes auth.login_success and auth.login_failed audit rows', async () => {
    // Successful login.
    const okRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    expect(okRes.status).toBe(200);

    // Failed login.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: 'wrong-on-purpose' });

    // Audit log writes are fire-and-forget; give the event loop a tick
    // to flush the inserts.
    await new Promise((r) => setTimeout(r, 200));

    const recent = await prisma.auditLog.findMany({
      where: { entity: 'auth' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const actions = recent.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['auth.login_success', 'auth.login_failed']),
    );
  });
});
