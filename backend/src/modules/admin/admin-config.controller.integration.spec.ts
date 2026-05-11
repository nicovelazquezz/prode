import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

describe('AdminConfig CRUD (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  const stamp =
    (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;

  // Snapshots para revertir cambios y mantener seeds intactos.
  let appConfigSnapshot: Map<string, string>;
  let scoringRuleSnapshot: Map<string, number>;
  let phaseMultiplierSnapshot: Map<string, number>;
  let specialPrizeSnapshot: Map<string, number>;

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

    const dni = String(86_000_000 + stamp).slice(-8);
    const password = 'CfgOuts!1';
    const bcrypt = await import('bcrypt');
    await prisma.user.create({
      data: {
        dni,
        firstName: 'Cfg',
        lastName: 'Outs',
        whatsapp: `549${String(8_600_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    const userLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password });
    expect(userLogin.status).toBe(200);
    userToken = userLogin.body.accessToken;

    // Snapshots para restaurar después.
    const cfgs = await prisma.appConfig.findMany();
    appConfigSnapshot = new Map(cfgs.map((c) => [c.key, c.value]));
    const sr = await prisma.scoringRule.findMany();
    scoringRuleSnapshot = new Map(sr.map((r) => [r.outcomeType, r.basePoints]));
    const pm = await prisma.phaseMultiplier.findMany();
    phaseMultiplierSnapshot = new Map(
      pm.map((p) => [p.phase, Number(p.multiplier)]),
    );
    const sp = await prisma.specialPrizeRule.findMany();
    specialPrizeSnapshot = new Map(sp.map((s) => [s.key, s.points]));
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Restaurar todos los valores originales.
      for (const [k, v] of appConfigSnapshot) {
        await prisma.appConfig.update({ where: { key: k }, data: { value: v, updatedBy: null } });
      }
      for (const [t, p] of scoringRuleSnapshot) {
        await prisma.scoringRule.update({
          where: { outcomeType: t as 'EXACT' | 'WINNER_AND_DIFF' | 'DRAW_DIFFERENT' | 'WINNER_ONLY' | 'MISS' },
          data: { basePoints: p, updatedBy: null },
        });
      }
      for (const [ph, m] of phaseMultiplierSnapshot) {
        await prisma.phaseMultiplier.update({
          where: { phase: ph as 'GROUPS' | 'ROUND_32' | 'ROUND_16' | 'QUARTERS' | 'SEMIS' | 'THIRD_PLACE' | 'FINAL' },
          data: { multiplier: m, updatedBy: null },
        });
      }
      for (const [k, p] of specialPrizeSnapshot) {
        await prisma.specialPrizeRule.update({
          where: { key: k },
          data: { points: p, updatedBy: null },
        });
      }
      await prisma.user.deleteMany({
        where: { dni: { in: [String(86_000_000 + stamp).slice(-8)] } },
      });
    }
    if (app) await app.close();
  });

  describe('AppConfig', () => {
    it('GET /admin/config — admin only, returns all rows', async () => {
      await request(app.getHttpServer()).get('/admin/config').expect(401);
      await request(app.getHttpServer())
        .get('/admin/config')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      const res = await request(app.getHttpServer())
        .get('/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('key');
      expect(res.body[0]).toHaveProperty('value');
    });

    it('PUT /admin/config/:key — updates value + sets updatedBy + audits', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/config/inscripcion_precio')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: '12345' })
        .expect(200);

      expect(res.body.value).toBe('12345');
      expect(res.body.updatedBy).toBeTruthy();

      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'app_config', entityId: 'inscripcion_precio' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.action).toBe('config.app_updated');
    });

    it('PUT /admin/config/:key — 404 for unknown key', async () => {
      await request(app.getHttpServer())
        .put('/admin/config/does_not_exist')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'X' })
        .expect(404);
    });
  });

  describe('ScoringRule', () => {
    it('GET /admin/scoring-rules — returns 5 rules', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/scoring-rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.length).toBe(5);
    });

    it('PUT /admin/scoring-rules/:outcomeType — updates basePoints + audits', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/scoring-rules/EXACT')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ basePoints: 10 })
        .expect(200);
      expect(res.body.basePoints).toBe(10);
      expect(res.body.updatedBy).toBeTruthy();
    });

    it('PUT /admin/scoring-rules/:outcomeType — 400 for invalid enum', async () => {
      await request(app.getHttpServer())
        .put('/admin/scoring-rules/BOGUS')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ basePoints: 10 })
        .expect(400);
    });
  });

  describe('PhaseMultiplier', () => {
    it('GET /admin/phase-multipliers — returns 7 phases with numeric multipliers', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/phase-multipliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.length).toBe(7);
      expect(typeof res.body[0].multiplier).toBe('number');
    });

    it('PUT /admin/phase-multipliers/:phase — updates multiplier + audits', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/phase-multipliers/GROUPS')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ multiplier: 1.2 })
        .expect(200);
      expect(res.body.multiplier).toBe(1.2);
    });
  });

  describe('SpecialPrizeRule', () => {
    it('GET /admin/special-prize-rules — returns rules', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/special-prize-rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('PUT /admin/special-prize-rules/:key — updates points + audits', async () => {
      const res = await request(app.getHttpServer())
        .put('/admin/special-prize-rules/champion')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ points: 30 })
        .expect(200);
      expect(res.body.points).toBe(30);
    });

    it('PUT /admin/special-prize-rules/:key — 404 for unknown key', async () => {
      await request(app.getHttpServer())
        .put('/admin/special-prize-rules/does-not-exist')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ points: 10 })
        .expect(404);
    });
  });
});
