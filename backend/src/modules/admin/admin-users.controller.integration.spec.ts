import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP integration tests para los endpoints de gestión de users:
 *   - PATCH /admin/users/:id           — editar firstName/lastName/whatsapp/status/role
 *   - POST  /admin/users/:id/reset-password
 *
 * (`POST /admin/users` para creación manual ya tiene cobertura E2E
 * en `src/test/e2e/admin-manual-user.e2e.spec.ts`.)
 */
describe('AdminUsers PATCH + reset-password (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  let targetUserId: string;
  const stamp =
    (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;

  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    if (adminLogin.status !== 200) {
      throw new Error(
        `Admin login failed (status ${adminLogin.status}). Run prisma/seed-config.ts.`,
      );
    }
    adminToken = adminLogin.body.accessToken;

    // Non-admin actor.
    const outsiderDni = String(92_000_000 + stamp).slice(-8);
    const outsiderPwd = 'AdmUsersOuts!1';
    const bcrypt = await import('bcrypt');
    await prisma.user.create({
      data: {
        dni: outsiderDni,
        firstName: 'Out',
        lastName: 'Sider',
        whatsapp: `549${String(9_200_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: await bcrypt.hash(outsiderPwd, 10),
      },
    });
    const outsiderLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: outsiderDni, password: outsiderPwd });
    expect(outsiderLogin.status).toBe(200);
    userToken = outsiderLogin.body.accessToken;

    // Target user que vamos a mutar.
    const targetDni = String(91_000_000 + stamp).slice(-8);
    const targetUser = await prisma.user.create({
      data: {
        dni: targetDni,
        firstName: 'Target',
        lastName: 'Original',
        whatsapp: `549${String(9_100_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: await bcrypt.hash('OriginalPwd!1', 10),
        status: 'ACTIVE',
      },
    });
    targetUserId = targetUser.id;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.refreshToken.deleteMany({
        where: { user: { dni: { startsWith: '9' } } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          entityId: targetUserId,
          action: { in: ['user.updated_by_admin', 'user.password_reset_by_admin'] },
        },
      });
      await prisma.user.deleteMany({
        where: { id: targetUserId },
      });
      await prisma.user.deleteMany({
        where: { dni: { in: [String(92_000_000 + stamp).slice(-8)] } },
      });
    }
    if (app) await app.close();
  });

  describe('PATCH /admin/users/:id', () => {
    it('rejects unauthenticated with 401', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/users/${targetUserId}`)
        .send({ firstName: 'X' })
        .expect(401);
    });

    it('rejects non-admin with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/users/${targetUserId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ firstName: 'X' })
        .expect(403);
    });

    it('returns 404 for non-existent user', async () => {
      await request(app.getHttpServer())
        .patch('/admin/users/does-not-exist')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'X' })
        .expect(404);
    });

    it('updates firstName + status + audits diff', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${targetUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Renamed', status: 'INACTIVE' })
        .expect(200);

      expect(res.body).toMatchObject({
        id: targetUserId,
        firstName: 'Renamed',
        status: 'INACTIVE',
        lastName: 'Original',
      });

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: targetUserId,
          action: 'user.updated_by_admin',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
      const changes = audit?.changes as Record<string, unknown>;
      expect(changes).toHaveProperty('firstName');
      expect(changes).toHaveProperty('status');
    });

    it('rejects bad whatsapp format with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/users/${targetUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ whatsapp: 'abc' })
        .expect(400);
    });

    it('rejects whatsapp duplicate with 409', async () => {
      // Crear otro user para chocar contra él.
      const dup = await prisma.user.create({
        data: {
          dni: String(90_000_000 + stamp).slice(-8),
          firstName: 'Dup',
          lastName: 'User',
          whatsapp: `549${String(9_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
          passwordHash:
            '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX',
        },
      });
      try {
        await request(app.getHttpServer())
          .patch(`/admin/users/${targetUserId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ whatsapp: dup.whatsapp })
          .expect(409);
      } finally {
        await prisma.user.delete({ where: { id: dup.id } });
      }
    });

    it('rejects admin demoting themselves to USER with 400', async () => {
      // Login del admin para extraer su id.
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const adminId = me.body.id;
      await request(app.getHttpServer())
        .patch(`/admin/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'USER' })
        .expect(400);
    });
  });

  describe('POST /admin/users/:id/reset-password', () => {
    it('rejects unauthenticated with 401', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${targetUserId}/reset-password`)
        .expect(401);
    });

    it('rejects non-admin with 403', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${targetUserId}/reset-password`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('returns 404 for non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/admin/users/no-existe/reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('rotates password, returns plain, and revokes refresh tokens', async () => {
      // Crear un refresh token para el target — verificamos que se revoca.
      const tokenHash = 'abc123_test_hash_not_real_' + stamp;
      const rt = await prisma.refreshToken.create({
        data: {
          userId: targetUserId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60_000 * 60),
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/users/${targetUserId}/reset-password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.password).toMatch(/^[a-f0-9]{12}$/);

      const updatedRt = await prisma.refreshToken.findUnique({
        where: { id: rt.id },
      });
      expect(updatedRt?.revokedAt).toBeTruthy();

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: targetUserId,
          action: 'user.password_reset_by_admin',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
      // No persistir el plaintext.
      expect(JSON.stringify(audit?.changes)).not.toContain(res.body.password);
    });
  });
});
