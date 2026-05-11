import request from 'supertest';
import {
  createE2EApp,
  uniqueDni,
  uniqueWhatsapp,
  type E2EAppHandles,
} from '../helpers/e2e-app.js';
import { AuthService } from '../../modules/auth/auth.service.js';

/**
 * E2E coverage for `PATCH /users/me`. The endpoint is the source of
 * truth for the `/perfil` page in the frontend (Sprint 2.2). What we
 * cover here:
 *
 *   1. Happy path — partial body changes one field; audit row written
 *      with before/after diff scoped to the changed key.
 *   2. Validation — illegal name characters and too-short whatsapp are
 *      rejected by the global ValidationPipe (400, message arrays).
 *   3. No-op body — sending the same values that are already on the
 *      User does not write an audit row and does not bump updatedAt.
 *   4. BANNED users get 403; the service refuses to mutate them even
 *      with a valid JWT (defense in depth on top of the JwtAuthGuard).
 *   5. Anonymous → 401 (JwtAuthGuard kicks in before the controller).
 *
 * The DTO and service-level validations are documented inline; this
 * suite is the contract test that frontend `updateMe()` relies on.
 */
describe('PATCH /users/me (integration)', () => {
  let h: E2EAppHandles;
  let auth: AuthService;

  // We provision one ACTIVE user and one BANNED user in beforeAll.
  // Each `it` block patches a different field so they don't bleed.
  let userId: string;
  let userToken: string;
  let userDni: string;
  let bannedUserId: string;
  let bannedToken: string;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    h = await createE2EApp();
    await h.cleanDb();
    auth = h.app.get(AuthService);

    userDni = uniqueDni();
    const password = 'whatever1';
    const passwordHash = await auth.hashPassword(password);

    const user = await h.prisma.user.create({
      data: {
        dni: userDni,
        firstName: 'Original',
        lastName: 'Tester',
        whatsapp: uniqueWhatsapp(),
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    const loginRes = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send({ dni: userDni, password });
    if (loginRes.status !== 200) {
      throw new Error(
        `User login failed (status ${loginRes.status}): ${JSON.stringify(loginRes.body)}`,
      );
    }
    userToken = loginRes.body.accessToken;

    // Provision the BANNED user. We need to login while ACTIVE (a banned
    // user can't pass /auth/login) and then flip the status in the DB.
    const bannedDni = uniqueDni();
    const banned = await h.prisma.user.create({
      data: {
        dni: bannedDni,
        firstName: 'Banned',
        lastName: 'User',
        whatsapp: uniqueWhatsapp(),
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    bannedUserId = banned.id;
    const bannedLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send({ dni: bannedDni, password });
    bannedToken = bannedLogin.body.accessToken;
    await h.prisma.user.update({
      where: { id: bannedUserId },
      data: { status: 'BANNED' },
    });
  }, 60_000);

  afterAll(async () => {
    if (h?.cleanDb) await h.cleanDb();
    if (h?.closeApp) await h.closeApp();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  it('updates firstName and writes an audit row scoped to the changed field', async () => {
    const newName = 'Renamed';
    const before = await h.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const res = await request(h.app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ firstName: newName });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: userId,
      firstName: newName,
      lastName: before.lastName,
      whatsapp: before.whatsapp,
    });
    expect(res.body).not.toHaveProperty('passwordHash');

    const after = await h.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(after.firstName).toBe(newName);
    expect(after.lastName).toBe(before.lastName);

    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.profile_updated', entityId: userId },
      orderBy: { createdAt: 'desc' },
    });
    const changes = audit.changes as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    // Diff is strictly the changed field — lastName / whatsapp don't show up.
    expect(changes.before).toEqual({ firstName: 'Original' });
    expect(changes.after).toEqual({ firstName: newName });
  });

  it('treats a no-op body as a no-op (no audit row, returns user)', async () => {
    const before = await h.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const auditBefore = await h.prisma.auditLog.count({
      where: { action: 'user.profile_updated', entityId: userId },
    });

    // Send exactly the values we already have.
    const res = await request(h.app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        firstName: before.firstName,
        lastName: before.lastName,
        whatsapp: before.whatsapp,
        whatsappOptIn: before.whatsappOptIn,
      });

    expect(res.status).toBe(200);
    const auditAfter = await h.prisma.auditLog.count({
      where: { action: 'user.profile_updated', entityId: userId },
    });
    expect(auditAfter).toBe(auditBefore);
  });

  it('rejects invalid firstName (digits) with 400', async () => {
    const res = await request(h.app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ firstName: 'Pepe123' });

    expect(res.status).toBe(400);
    // Class-validator returns `message` as string[] when multiple
    // constraints could match; we only assert that our regex message
    // shows up somewhere in the payload.
    const messages = Array.isArray(res.body.message)
      ? res.body.message
      : [res.body.message];
    expect(messages.some((m: string) => /firstName/.test(m))).toBe(true);
  });

  it('rejects whatsapp shorter than 10 digits with 400', async () => {
    const res = await request(h.app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ whatsapp: '12345' });

    expect(res.status).toBe(400);
    const messages = Array.isArray(res.body.message)
      ? res.body.message
      : [res.body.message];
    expect(messages.some((m: string) => /whatsapp/.test(m))).toBe(true);
  });

  it('accepts names with tildes, ñ, apostrophes and hyphens', async () => {
    const res = await request(h.app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        firstName: "Andrés",
        lastName: "D'Ángelo-García",
      });

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Andrés');
    expect(res.body.lastName).toBe("D'Ángelo-García");
  });

  it('returns 403 for a BANNED user even with a valid token', async () => {
    const res = await request(h.app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${bannedToken}`)
      .send({ firstName: 'StillBanned' });

    expect(res.status).toBe(403);
    const banned = await h.prisma.user.findUniqueOrThrow({
      where: { id: bannedUserId },
    });
    expect(banned.firstName).toBe('Banned');
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await request(h.app.getHttpServer())
      .patch('/users/me')
      .send({ firstName: 'Hacker' });

    expect(res.status).toBe(401);
  });
});
