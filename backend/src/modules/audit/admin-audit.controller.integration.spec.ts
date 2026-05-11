import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

describe('GET /admin/audit (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  const stamp =
    (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;
  const TEST_ACTION = `test.audit_${stamp}`;
  const createdAuditIds: string[] = [];

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
      throw new Error('Admin login failed — run prisma/seed-config.ts');
    }
    adminToken = adminLogin.body.accessToken;

    const dni = String(88_000_000 + stamp).slice(-8);
    const password = 'AuditOuts!1';
    const bcrypt = await import('bcrypt');
    await prisma.user.create({
      data: {
        dni,
        firstName: 'Aud',
        lastName: 'Out',
        whatsapp: `549${String(8_800_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    const userLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password });
    expect(userLogin.status).toBe(200);
    userToken = userLogin.body.accessToken;

    // Sembrar 3 audit rows con TEST_ACTION para los filtros.
    for (let i = 0; i < 3; i++) {
      const row = await prisma.auditLog.create({
        data: {
          action: TEST_ACTION,
          entity: 'test_entity',
          entityId: `test-${stamp}-${i}`,
          changes: { i },
        },
      });
      createdAuditIds.push(row.id);
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma && createdAuditIds.length) {
      await prisma.auditLog.deleteMany({
        where: { id: { in: createdAuditIds } },
      });
      await prisma.user.deleteMany({
        where: { dni: { in: [String(88_000_000 + stamp).slice(-8)] } },
      });
    }
    if (app) await app.close();
  });

  it('rejects unauthenticated with 401', async () => {
    await request(app.getHttpServer()).get('/admin/audit').expect(401);
  });

  it('rejects non-admin role with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('returns paginated shape for admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/audit?pageSize=5')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      page: 1,
      pageSize: 5,
      total: expect.any(Number),
      data: expect.any(Array),
    });
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('action');
      expect(res.body.data[0]).toHaveProperty('entity');
      expect(res.body.data[0]).toHaveProperty('createdAt');
    }
  });

  it('filters by action', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/audit?action=${TEST_ACTION}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBe(3);
    for (const row of res.body.data) {
      expect(row.action).toBe(TEST_ACTION);
    }
  });

  it('filters by entity', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/audit?entity=test_entity&pageSize=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const row of res.body.data) {
      expect(row.entity).toBe('test_entity');
    }
    expect(res.body.total).toBeGreaterThanOrEqual(3);
  });

  it('rejects bad fromDate with 400', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit?fromDate=not-a-date')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('respects pagination', async () => {
    const page1 = await request(app.getHttpServer())
      .get(`/admin/audit?action=${TEST_ACTION}&page=1&pageSize=2`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.data.length).toBe(2);

    const page2 = await request(app.getHttpServer())
      .get(`/admin/audit?action=${TEST_ACTION}&page=2&pageSize=2`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page2.body.data.length).toBe(1);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
  });
});
