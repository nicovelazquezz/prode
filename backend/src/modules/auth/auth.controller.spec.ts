import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { PasswordResetsService } from './password-resets.service.js';
import { AuthService } from './auth.service.js';

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

  /**
   * Regression: Phase 0 of the frontend plan flipped SameSite from
   * SameSite=Strict (CSRF hardening): frontend (`prodeplus.com`)
   * y API (`api.prodeplus.com`) son same-site (mismo eTLD+1
   * `prodeplus.com`), así que la cookie viaja en requests cross-origin
   * pero same-site iniciadas desde el frontend. Una página en `evil.com`
   * NO puede gatillar `/auth/refresh` ni `/auth/logout` porque el browser
   * no envía la cookie en requests cross-site con strict.
   *
   * El hint `has_session=1` es NON-httpOnly para que el frontend lo lea
   * con `document.cookie` y skip /auth/refresh en landings anónimos.
   * Ambos comparten `path=/` y scope para vivir y morir juntos.
   */
  it('emits both refresh_token (HttpOnly + SameSite=Strict) and has_session=1 cookies on login', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : ([setCookie] as string[]);

    const refresh = cookies.find((c) => c.startsWith('refresh_token='));
    expect(refresh).toBeDefined();
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Strict/i);
    expect(refresh).toMatch(/Path=\//i);

    const hint = cookies.find((c) => c.startsWith('has_session='));
    expect(hint).toBeDefined();
    // has_session must NOT be HttpOnly — frontend reads it from JS.
    expect(hint).not.toMatch(/HttpOnly/i);
    expect(hint).toMatch(/SameSite=Strict/i);
    expect(hint).toMatch(/Path=\//i);
    expect(hint!.split(';')[0]).toBe('has_session=1');
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

  it('clears both refresh_token and has_session cookies and revokes the row', async () => {
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
    const clearedRefresh = cookies.find((c) => c.startsWith('refresh_token='));
    expect(clearedRefresh).toBeDefined();
    // express clearCookie sets Expires in the past
    expect(clearedRefresh).toMatch(/Expires=Thu, 01 Jan 1970/i);

    // Hint cookie must also be cleared — otherwise the frontend would keep
    // attempting refresh on landing despite the session being gone.
    const clearedHint = cookies.find((c) => c.startsWith('has_session='));
    expect(clearedHint).toBeDefined();
    expect(clearedHint).toMatch(/Expires=Thu, 01 Jan 1970/i);

    // Same refresh cookie cannot be used afterwards.
    const refreshAttempt = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [refreshCookie]);
    expect(refreshAttempt.status).toBe(401);
  });
});

describe('POST /auth/forgot-password (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns 200 OK for an unknown DNI and creates no records', async () => {
    const before = await prisma.passwordReset.count();
    const beforeNotif = await prisma.notification.count({
      where: { type: 'PASSWORD_RESET' },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ dni: '99999999' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(await prisma.passwordReset.count()).toBe(before);
    expect(
      await prisma.notification.count({ where: { type: 'PASSWORD_RESET' } }),
    ).toBe(beforeNotif);
  });

  it('issues a hashed reset token and a PENDING WhatsApp notification for a known user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ dni: ADMIN_DNI });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const admin = await prisma.user.findUniqueOrThrow({
      where: { dni: ADMIN_DNI },
    });
    const reset = await prisma.passwordReset.findFirst({
      where: { userId: admin.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(reset).not.toBeNull();
    expect(reset!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reset!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const notif = await prisma.notification.findFirst({
      where: { userId: admin.id, type: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notif).not.toBeNull();
    expect(notif!.status).toBe('PENDING');
    expect(notif!.channel).toBe('WHATSAPP');
    expect(notif!.toAddress).toBe(admin.whatsapp);
    // Plain token is in the message, but never in the DB row.
    expect(notif!.message).toMatch(/\/reset\?token=[0-9a-f]{64}/);
  });

  it('returns 400 for malformed DNI', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ dni: 'abc' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/reset-password (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordResets: PasswordResetsService;
  let authService: AuthService;
  let testUserId: string;
  // The seed admin password is what we restore after each mutating test
  // so the suite stays idempotent regardless of test ordering.
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
    passwordResets = app.get(PasswordResetsService);
    authService = app.get(AuthService);

    // Use a dedicated user so we don't disturb the admin password and
    // can clean up between tests without race conditions.
    const dniSuffix = Date.now().toString().slice(-7);
    const passwordHash = await authService.hashPassword('OldPassword1');
    const user = await prisma.user.create({
      data: {
        dni: `1${dniSuffix}`,
        firstName: 'Reset',
        lastName: 'Test',
        whatsapp: `54911${dniSuffix}`,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    testUserId = user.id;
  }, 30_000);

  afterAll(async () => {
    if (testUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: testUserId } });
      await prisma.passwordReset.deleteMany({ where: { userId: testUserId } });
      await prisma.auditLog.deleteMany({ where: { userId: testUserId } });
      await prisma.notification.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
    if (app) await app.close();
  });

  it('rejects an unknown token with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'a'.repeat(64),
        newPassword: 'NewPassword1',
      });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token / weak password with 400', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/reset-password')
          .send({ token: 'short', newPassword: 'NewPassword1' })
      ).status,
    ).toBe(400);

    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/reset-password')
          .send({ token: 'a'.repeat(64), newPassword: 'noNumbers' })
      ).status,
    ).toBe(400);

    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/reset-password')
          .send({ token: 'a'.repeat(64), newPassword: 'short1' })
      ).status,
    ).toBe(400);
  });

  it('updates the password, marks the token used, and revokes refresh tokens', async () => {
    // Issue a real reset token for our test user.
    const { plain, record } = await passwordResets.create(testUserId);

    // Also seed an active refresh token; it should get revoked on reset.
    const refreshHash = authService.hashToken('some-active-refresh');
    const refreshRow = await prisma.refreshToken.create({
      data: {
        userId: testUserId,
        tokenHash: refreshHash,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: plain, newPassword: 'BrandNewPass2' });
    expect(res.status).toBe(200);

    // Token row marked used.
    const consumed = await prisma.passwordReset.findUnique({
      where: { id: record.id },
    });
    expect(consumed!.usedAt).not.toBeNull();

    // Existing refresh token revoked.
    const refreshAfter = await prisma.refreshToken.findUnique({
      where: { id: refreshRow.id },
    });
    expect(refreshAfter!.revokedAt).not.toBeNull();

    // New password works on /auth/login.
    const loginNew = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: (await prisma.user.findUniqueOrThrow({
        where: { id: testUserId },
      })).dni, password: 'BrandNewPass2' });
    expect(loginNew.status).toBe(200);

    // Old password no longer works.
    const loginOld = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: (await prisma.user.findUniqueOrThrow({
        where: { id: testUserId },
      })).dni, password: 'OldPassword1' });
    expect(loginOld.status).toBe(401);
  });

  it('rejects a token that was already used', async () => {
    const { plain } = await passwordResets.create(testUserId);
    // Consume it.
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/reset-password')
          .send({ token: plain, newPassword: 'AnotherPass3' })
      ).status,
    ).toBe(200);
    // Re-using must fail.
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/reset-password')
          .send({ token: plain, newPassword: 'AnotherPass3' })
      ).status,
    ).toBe(401);
  });

  it('writes auth.password_reset_completed audit row', async () => {
    const { plain } = await passwordResets.create(testUserId);
    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: plain, newPassword: 'YetAnotherPass4' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 200));
    const audit = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: 'auth.password_reset_completed',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();

    // Sanity: the seed admin login still works (we never touched its row).
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD })
      ).status,
    ).toBe(200);
  });
});

/**
 * Tests for `GET /auth/me`. The endpoint backs the AuthProvider's
 * "rehydrate session on landing" flow — the frontend calls it after
 * /auth/refresh to populate the in-memory user object.
 *
 * Critical guarantees:
 *   - 401 without a valid access token (global guard).
 *   - 200 with a curated subset of User columns; passwordHash MUST
 *     never appear in the response.
 *   - The shape lines up with the public User type the frontend
 *     consumes (see spec §5).
 */
describe('GET /auth/me (integration)', () => {
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

  async function loginAndGrabAccessToken(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken;
  }

  it('returns 401 when no Authorization header is present', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid bearer token', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('returns the curated user payload for a valid bearer token', async () => {
    const token = await loginAndGrabAccessToken();
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dni: ADMIN_DNI,
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    // Required surface for the frontend AuthProvider.
    expect(res.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        dni: expect.any(String),
        firstName: expect.any(String),
        lastName: expect.any(String),
        whatsapp: expect.any(String),
        role: expect.any(String),
        status: expect.any(String),
        whatsappOptIn: expect.any(Boolean),
        // createdAt + lastLoginAt are ISO strings on the wire.
        createdAt: expect.any(String),
      }),
    );
    // lastLoginAt may be null on a freshly-seeded admin if the suite
    // restored it; tolerate both.
    expect(['string', 'object']).toContain(typeof res.body.lastLoginAt);
  });

  it('NEVER leaks passwordHash, refreshTokens, or other sensitive fields', async () => {
    const token = await loginAndGrabAccessToken();
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // The select in the controller is the gate — this assertion catches
    // any future regression where a maintainer swaps to `findUnique({})`
    // without an explicit select clause.
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('refreshTokens');
    expect(res.body).not.toHaveProperty('passwordResets');
  });
});

/**
 * Tests for `POST /auth/change-password`. The endpoint exists for the
 * authenticated "settings → cambiar contraseña" flow — different from
 * /auth/reset-password (which is consumed via a one-time token from
 * forgot-password).
 *
 * Critical invariants:
 *   - Requires a valid bearer (401 otherwise).
 *   - Validates the *current* password against the stored hash (400 on
 *     mismatch). This guards against an attacker who has a stolen
 *     access token but doesn't know the password.
 *   - Bumps the password hash AND revokes ALL active refresh tokens
 *     atomically — any other live session on a stolen device is
 *     forced to re-authenticate.
 *   - Audits both the failed and the successful attempts.
 */
describe('POST /auth/change-password (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  // Dedicated user so we don't disturb the seed admin password and
  // can clean up between/after tests.
  let testUserId: string;
  let testDni: string;
  const INITIAL_PASSWORD = 'InitialPass1';

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
    testDni = `2${dniSuffix}`;
    const passwordHash = await authService.hashPassword(INITIAL_PASSWORD);
    const user = await prisma.user.create({
      data: {
        dni: testDni,
        firstName: 'Change',
        lastName: 'Pwd',
        whatsapp: `54912${dniSuffix}`,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    testUserId = user.id;
  }, 30_000);

  afterAll(async () => {
    if (testUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: testUserId } });
      await prisma.auditLog.deleteMany({ where: { userId: testUserId } });
      await prisma.notification.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
    if (app) await app.close();
  });

  /** Login fresh and return access token + refresh cookie. */
  async function loginFresh(
    password: string,
  ): Promise<{ accessToken: string; refreshCookie: string }> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: testDni, password });
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

  /**
   * Each mutating test rebases on a known password so the suite stays
   * idempotent regardless of order. We DO NOT rely on JIT password
   * resets via the service — calling /auth/login + /auth/change-password
   * is the contract the frontend uses, so testing through the same
   * surface keeps the assertion honest.
   */
  async function ensurePasswordIs(target: string): Promise<void> {
    const newHash = await authService.hashPassword(target);
    await prisma.user.update({
      where: { id: testUserId },
      data: { passwordHash: newHash },
    });
  }

  it('returns 401 without a bearer token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: 'WhateverPass2' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when newPassword is too short or missing a digit', async () => {
    await ensurePasswordIs(INITIAL_PASSWORD);
    const { accessToken } = await loginFresh(INITIAL_PASSWORD);

    const tooShort = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: 'short1' });
    expect(tooShort.status).toBe(400);

    const noDigits = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: 'noDigitsHere' });
    expect(noDigits.status).toBe(400);
  });

  it('returns 400 when currentPassword is wrong', async () => {
    await ensurePasswordIs(INITIAL_PASSWORD);
    const { accessToken } = await loginFresh(INITIAL_PASSWORD);

    const res = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'definitely-not-right',
        newPassword: 'BrandNewPass3',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/contraseña actual incorrecta/i);

    // Audit row records the failure.
    await new Promise((r) => setTimeout(r, 200));
    const audit = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: 'auth.change_password_failed',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('returns 400 when newPassword equals currentPassword', async () => {
    await ensurePasswordIs(INITIAL_PASSWORD);
    const { accessToken } = await loginFresh(INITIAL_PASSWORD);

    const res = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: INITIAL_PASSWORD,
        newPassword: INITIAL_PASSWORD,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/distinta/i);
  });

  it('happy path: 204, password rotated, ALL refresh tokens revoked, audit row written', async () => {
    await ensurePasswordIs(INITIAL_PASSWORD);
    // Two active sessions to prove ALL of them get killed.
    const sessionA = await loginFresh(INITIAL_PASSWORD);
    const sessionB = await loginFresh(INITIAL_PASSWORD);

    const res = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${sessionA.accessToken}`)
      .send({
        currentPassword: INITIAL_PASSWORD,
        newPassword: 'BrandNewSecret9',
      });
    expect(res.status).toBe(204);

    // Old password rejected on a fresh login attempt.
    const loginOld = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: testDni, password: INITIAL_PASSWORD });
    expect(loginOld.status).toBe(401);

    // New password works.
    const loginNew = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: testDni, password: 'BrandNewSecret9' });
    expect(loginNew.status).toBe(200);

    // Both pre-change refresh cookies must be dead. The frontend will
    // see /auth/refresh fail and bounce to /login.
    const refreshA = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [sessionA.refreshCookie]);
    expect(refreshA.status).toBe(401);
    const refreshB = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [sessionB.refreshCookie]);
    expect(refreshB.status).toBe(401);

    // Audit row written.
    await new Promise((r) => setTimeout(r, 200));
    const audit = await prisma.auditLog.findFirst({
      where: {
        userId: testUserId,
        action: 'auth.password_changed_by_user',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});
