import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

describe('GET /admin/metrics (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
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
      throw new Error('Admin login failed — run prisma/seed-config.ts');
    }
    adminToken = adminLogin.body.accessToken;

    const dni = String(87_000_000 + stamp).slice(-8);
    const password = 'MetricsOuts!1';
    const bcrypt = await import('bcrypt');
    await prisma.user.create({
      data: {
        dni,
        firstName: 'Met',
        lastName: 'Outs',
        whatsapp: `549${String(8_700_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    const userLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password });
    expect(userLogin.status).toBe(200);
    userToken = userLogin.body.accessToken;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: { dni: { in: [String(87_000_000 + stamp).slice(-8)] } },
      });
    }
    if (app) await app.close();
  });

  it('rejects unauthenticated with 401', async () => {
    await request(app.getHttpServer()).get('/admin/metrics').expect(401);
  });

  it('rejects non-admin with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/metrics')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('returns the full AdminMetrics shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/metrics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Shape matches `AdminMetrics` del frontend.
    expect(res.body).toMatchObject({
      totals: {
        users: expect.any(Number),
        active: expect.any(Number),
        pending: expect.any(Number),
        banned: expect.any(Number),
      },
      revenue: {
        total: expect.any(Number),
        paidUserCount: expect.any(Number),
      },
      predictions: {
        loaded: expect.any(Number),
        expected: expect.any(Number),
      },
      sparklines: {
        usersByDay: expect.any(Array),
        revenueByDay: expect.any(Array),
      },
    });

    expect(res.body.sparklines.usersByDay).toHaveLength(14);
    expect(res.body.sparklines.revenueByDay).toHaveLength(14);
    // nextMatch puede ser null si no hay scheduled futuros, pero si está
    // debe tener el shape correcto.
    if (res.body.nextMatch) {
      expect(res.body.nextMatch).toMatchObject({
        id: expect.any(String),
        kickoffAt: expect.any(String),
        homeLabel: expect.any(String),
        awayLabel: expect.any(String),
      });
    }
  });

  it('predictions.expected = matchCount * activeEntries', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/metrics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const matchCount = await prisma.match.count();
    const activeEntries = await prisma.entry.count({
      where: { status: 'ACTIVE' },
    });
    expect(res.body.predictions.expected).toBe(matchCount * activeEntries);
  });

  it('sparkline arrays sum to plausible totals', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/metrics')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Cada celda debe ser >= 0 y sum total no puede exceder los totales
    // globales (verificación sanity, no exacta porque la ventana es de 14d).
    const sumUsers = res.body.sparklines.usersByDay.reduce(
      (a: number, b: number) => a + b,
      0,
    );
    const sumRevenue = res.body.sparklines.revenueByDay.reduce(
      (a: number, b: number) => a + b,
      0,
    );
    expect(sumUsers).toBeLessThanOrEqual(res.body.totals.users);
    expect(sumRevenue).toBeLessThanOrEqual(res.body.revenue.total);
    for (const v of res.body.sparklines.usersByDay) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    for (const v of res.body.sparklines.revenueByDay) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
