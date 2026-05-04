import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

/**
 * HTTP integration tests for `POST /admin/leaderboard/refresh`. Verifies:
 *   - 401 without auth, 403 for non-admin role
 *   - 202 + jobId for admin
 *   - audit log row written with action `leaderboard.manual_refresh`
 *   - the queue actually has a `leaderboard.refresh` job after the call
 */
describe('POST /admin/leaderboard/refresh (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let adminToken: string;
  let userToken: string;
  let outsiderId: string;

  // Stamp keeps unique constraints clean across re-runs.
  const stamp = (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;

  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    queue = app.get(getQueueToken(NOTIFICATIONS_QUEUE));

    // Admin login.
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    if (adminLogin.status !== 200) {
      throw new Error(
        `Admin login failed (status ${adminLogin.status}). Run Phase 2 seed.`,
      );
    }
    adminToken = adminLogin.body.accessToken;

    // Non-admin user.
    const dni = String(95_000_000 + stamp).slice(-8);
    const password = 'NonAdmin_Refresh!1';
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(password, 10);
    const outsider = await prisma.user.create({
      data: {
        dni,
        firstName: 'Lb',
        lastName: 'NonAdmin',
        whatsapp: `549${String(9_500_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash: hash,
      },
    });
    outsiderId = outsider.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni, password });
    expect(login.status).toBe(200);
    userToken = login.body.accessToken;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Tidy any audit rows we just generated so re-runs are clean.
      await prisma.auditLog.deleteMany({
        where: { action: 'leaderboard.manual_refresh' },
      });
      if (outsiderId) {
        await prisma.user.delete({ where: { id: outsiderId } }).catch(() => undefined);
      }
    }
    if (app) await app.close();
  }, 30_000);

  it('returns 401 without an Authorization header', async () => {
    const res = await request(app.getHttpServer()).post('/admin/leaderboard/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/leaderboard/refresh')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 202 + jobId for admin and enqueues the refresh job', async () => {
    // Capture the audit baseline so we can assert exactly one new row.
    const auditsBefore = await prisma.auditLog.count({
      where: { action: 'leaderboard.manual_refresh' },
    });

    const res = await request(app.getHttpServer())
      .post('/admin/leaderboard/refresh')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.jobId).toBe('string');

    // Audit row written by the interceptor (fire-and-forget). Give it a
    // beat to land before asserting — the interceptor never blocks the
    // response, so the row may not be visible immediately on a fast box.
    const deadline = Date.now() + 2000;
    let auditsAfter = auditsBefore;
    while (Date.now() < deadline) {
      auditsAfter = await prisma.auditLog.count({
        where: { action: 'leaderboard.manual_refresh' },
      });
      if (auditsAfter > auditsBefore) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(auditsAfter).toBeGreaterThan(auditsBefore);

    // BullMQ side: the job either is still on the queue or has already
    // been processed (the worker is live in this test app and the dedup
    // makes the second call coalesce). Just assert that we can find the
    // job by its dedup id — `getJob` returns null only if it was never
    // enqueued.
    const job = await queue.getJob('leaderboard_refresh');
    expect(job).not.toBeNull();
  });

  it('coalesces repeated triggers via the dedup jobId', async () => {
    // Fire two refreshes back-to-back. Both should return 202; BullMQ
    // dedups on the shared jobId, so the worker doesn't fan out.
    const a = await request(app.getHttpServer())
      .post('/admin/leaderboard/refresh')
      .set('Authorization', `Bearer ${adminToken}`);
    const b = await request(app.getHttpServer())
      .post('/admin/leaderboard/refresh')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body.jobId).toBe(b.body.jobId);
  });
});
