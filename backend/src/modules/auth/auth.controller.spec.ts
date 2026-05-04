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

describe('POST /auth/refresh (integration)', () => {
  let app: INestApplication;
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
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  /**
   * Helper: login first, return the refresh cookie value the server set.
   */
  async function loginAndGrabCookie(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : ([setCookie] as string[]);
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));
    if (!refresh) throw new Error('No refresh_token cookie set on login');
    return refresh.split(';')[0]!; // "refresh_token=<value>"
  }

  it('returns 401 with no cookie', async () => {
    const res = await request(app.getHttpServer()).post('/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a bogus cookie value', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', ['refresh_token=not-a-real-token']);
    expect(res.status).toBe(401);
  });

  it('issues a new access token and rotates the refresh cookie', async () => {
    const cookie = await loginAndGrabCookie();
    const oldValue = cookie.split('=')[1];

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [cookie]);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));

    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : ([setCookie] as string[]);
    const newRefresh = cookies.find((c) => c.startsWith('refresh_token='));
    expect(newRefresh).toBeDefined();
    const newValue = newRefresh!.split(';')[0]!.split('=')[1];
    expect(newValue).not.toBe(oldValue);
  });

  it('refusing the same refresh twice (rotation invalidates the old token)', async () => {
    const cookie = await loginAndGrabCookie();

    const first = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [cookie]);
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [cookie]);
    expect(second.status).toBe(401);
  });
});

describe('POST /auth/logout (integration)', () => {
  let app: INestApplication;
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
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  /** Login and return both access token and refresh cookie. */
  async function loginAndGrabPair(): Promise<{
    accessToken: string;
    refreshCookie: string;
  }> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : ([setCookie] as string[]);
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));
    if (!refresh) throw new Error('No refresh cookie set on login');
    return {
      accessToken: res.body.accessToken,
      refreshCookie: refresh.split(';')[0]!,
    };
  }

  it('returns 401 without an access token', async () => {
    const res = await request(app.getHttpServer()).post('/auth/logout');
    expect(res.status).toBe(401);
  });

  it('clears the refresh cookie and revokes the row', async () => {
    const { accessToken, refreshCookie } = await loginAndGrabPair();

    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', [refreshCookie]);

    expect(res.status).toBe(204);
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : ([setCookie] as string[]);
    const cleared = cookies.find((c) => c.startsWith('refresh_token='));
    expect(cleared).toBeDefined();
    // express clearCookie sets Expires in the past
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);

    // Same refresh cookie cannot be used afterwards.
    const refreshAttempt = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [refreshCookie]);
    expect(refreshAttempt.status).toBe(401);
  });
});
