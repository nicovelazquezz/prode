import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP integration tests for `GET /admin/payments`.
 *
 * Verifica:
 *   - 401 sin auth, 403 con rol USER
 *   - 200 admin con shape `{ data, total, page, pageSize }`
 *   - Filtros por status / method funcionan y siguen los índices del schema
 *   - Validación: status/method inválidos → 400
 *   - Paginación: respeta `page` y `pageSize`
 */
describe('GET /admin/payments (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  const createdPaymentIds: string[] = [];

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

    // Non-admin user.
    const dni = String(94_000_000 + stamp).slice(-8);
    const password = 'AdmPayments_NonAdmin!1';
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        dni,
        firstName: 'Pay',
        lastName: 'Outsider',
        whatsapp: `549${String(9_400_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: hash,
      },
    });
    const userLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password });
    expect(userLogin.status).toBe(200);
    userToken = userLogin.body.accessToken;

    // Crear 2 payments de prueba (uno APPROVED CASH, uno PENDING MERCADOPAGO)
    // para ejercer los filtros sin depender del estado de la DB.
    const p1 = await prisma.payment.create({
      data: {
        amount: 10000,
        method: 'CASH',
        status: 'APPROVED',
        notes: `test-${stamp}-cash-approved`,
      },
    });
    const p2 = await prisma.payment.create({
      data: {
        amount: 10000,
        method: 'MERCADOPAGO',
        status: 'PENDING',
        notes: `test-${stamp}-mp-pending`,
      },
    });
    createdPaymentIds.push(p1.id, p2.id);
  }, 30_000);

  afterAll(async () => {
    if (prisma && createdPaymentIds.length) {
      await prisma.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (app) await app.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer()).get('/admin/payments').expect(401);
  });

  it('rejects non-admin role with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('returns paginated shape for admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/payments?pageSize=5')
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
      const row = res.body.data[0];
      expect(typeof row.amount).toBe('number');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('method');
    }
  });

  it('filters by status=APPROVED', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/payments?status=APPROVED&pageSize=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const p of res.body.data) {
      expect(p.status).toBe('APPROVED');
    }
  });

  it('filters by method=MERCADOPAGO', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/payments?method=MERCADOPAGO&pageSize=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const p of res.body.data) {
      expect(p.method).toBe('MERCADOPAGO');
    }
  });

  it('rejects invalid status enum with 400', async () => {
    await request(app.getHttpServer())
      .get('/admin/payments?status=BOGUS')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('respects pagination', async () => {
    const page1 = await request(app.getHttpServer())
      .get('/admin/payments?page=1&pageSize=1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(1);
    expect(page1.body.data.length).toBeLessThanOrEqual(1);

    if (page1.body.total > 1) {
      const page2 = await request(app.getHttpServer())
        .get('/admin/payments?page=2&pageSize=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page2.body.page).toBe(2);
      // El primer elemento de page 2 no debe coincidir con el de page 1.
      if (page1.body.data[0] && page2.body.data[0]) {
        expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
      }
    }
  });

  describe('POST /admin/payments/:id/approve', () => {
    let testUserId: string;
    const approveTestStamp = `${stamp}-ap`;

    beforeAll(async () => {
      // User dedicado para los tests de approve (queremos contar entries
      // antes/después y aislar de otros tests).
      const dni = String(93_000_000 + stamp).slice(-8);
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash('AdmApproveTest!1', 10);
      const user = await prisma.user.create({
        data: {
          dni,
          firstName: 'Adm',
          lastName: 'Approve',
          whatsapp: `549${String(9_300_000_000 + stamp).slice(-9)}`.slice(0, 13),
          passwordHash: hash,
        },
      });
      testUserId = user.id;
    });

    afterAll(async () => {
      // Limpiar entries + payments del user + user mismo (FK orden).
      await prisma.entry.deleteMany({ where: { userId: testUserId } });
      await prisma.payment.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } });
    });

    it('approves a PENDING logged-in payment and creates entry', async () => {
      const payment = await prisma.payment.create({
        data: {
          userId: testUserId,
          amount: 10000,
          method: 'MERCADOPAGO',
          status: 'PENDING',
          notes: `${approveTestStamp}-1`,
        },
      });

      const before = await prisma.entry.count({ where: { userId: testUserId } });

      const res = await request(app.getHttpServer())
        .post(`/admin/payments/${payment.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body).toMatchObject({
        paymentId: payment.id,
        userId: testUserId,
        entryId: expect.any(String),
      });

      const updated = await prisma.payment.findUnique({
        where: { id: payment.id },
      });
      expect(updated?.status).toBe('APPROVED');
      expect(updated?.paidAt).toBeTruthy();

      const after = await prisma.entry.count({ where: { userId: testUserId } });
      expect(after).toBe(before + 1);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: payment.id, action: 'payment.admin_approved' },
      });
      expect(audit).toBeTruthy();
    });

    it('returns 400 when payment is already APPROVED', async () => {
      const payment = await prisma.payment.create({
        data: {
          userId: testUserId,
          amount: 10000,
          method: 'CASH',
          status: 'APPROVED',
          notes: `${approveTestStamp}-2`,
        },
      });
      await request(app.getHttpServer())
        .post(`/admin/payments/${payment.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('returns 404 when payment does not exist', async () => {
      await request(app.getHttpServer())
        .post('/admin/payments/does-not-exist/approve')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 400 when payment has no userId (anonymous flow)', async () => {
      const payment = await prisma.payment.create({
        data: {
          userId: null,
          amount: 10000,
          method: 'MERCADOPAGO',
          status: 'PENDING',
          notes: `${approveTestStamp}-3`,
        },
      });
      await request(app.getHttpServer())
        .post(`/admin/payments/${payment.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      // Limpieza: este payment no tiene userId, no se enmascara con
      // el `deleteMany({userId})` del afterAll.
      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it('rejects non-admin role with 403', async () => {
      const payment = await prisma.payment.create({
        data: {
          userId: testUserId,
          amount: 10000,
          method: 'MERCADOPAGO',
          status: 'PENDING',
          notes: `${approveTestStamp}-4`,
        },
      });
      await request(app.getHttpServer())
        .post(`/admin/payments/${payment.id}/approve`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });
});
