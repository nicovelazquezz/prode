import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Integration test for `GET /matches/:matchId/predictions/count` (Task 7.5).
 *
 * The endpoint is `@Public()` — no auth needed. We seed two predictions on
 * a single match (created via two throwaway users so the unique
 * (userId, matchId) constraint isn't violated) and assert the count comes
 * back as 2.
 */
describe('GET /matches/:matchId/predictions/count (public)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let matchId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const target = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 90 },
    });
    matchId = target.id;

    const passwordHash = await bcrypt.hash('count-test', 4);
    for (let i = 0; i < 2; i++) {
      const stamp = (Date.now() + i * 7) % 90_000_000;
      const user = await prisma.user.create({
        data: {
          dni: String(30_000_000 + stamp + i).slice(-8),
          firstName: `Count${i}`,
          lastName: 'Tester',
          whatsapp: `549${String(3_000_000_000 + stamp + i).slice(-9)}`.slice(
            0,
            13,
          ),
          passwordHash,
        },
      });
      userIds.push(user.id);
      const payment = await prisma.payment.create({
        data: {
          userId: user.id,
          amount: 10_000,
          method: 'CASH',
          status: 'APPROVED',
          paidAt: new Date(),
          completedAt: new Date(),
        },
      });
      const entry = await prisma.entry.create({
        data: {
          userId: user.id,
          paymentId: payment.id,
          position: 1,
          status: 'ACTIVE',
        },
      });
      await prisma.prediction.create({
        data: { entryId: entry.id, matchId, scoreHome: 1, scoreAway: i },
      });
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      if (userIds.length > 0) {
        // Predictions cascade from entries; deleting the user wipes
        // entry → prediction tree via the FK CASCADE.
        await prisma.auditLog.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
    if (app) await app.close();
  }, 30_000);

  it('returns the count for the match (>= 2 from seeded data)', async () => {
    const res = await request(app.getHttpServer()).get(
      `/matches/${matchId}/predictions/count`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(res.body.count).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 for a match with no predictions', async () => {
    // Pick a match deeper in the seed where the count tests above don't
    // touch it. matchNumber=100 is in ROUND_16 with no predictions written.
    const empty = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 100 },
    });
    const res = await request(app.getHttpServer()).get(
      `/matches/${empty.id}/predictions/count`,
    );
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it('does not require authentication', async () => {
    // Same as the first test, but explicit — proves @Public() worked.
    const res = await request(app.getHttpServer()).get(
      `/matches/${matchId}/predictions/count`,
    );
    expect(res.status).not.toBe(401);
  });

  it('cache invalidates on POST /predictions/match/:matchId (Task 7.6)', async () => {
    // Pick a fresh match (matchNumber 101) so we can observe the count
    // jumping from 0 → 1 within the 60 s TTL. If the writer didn't
    // invalidate the cache, the second GET would still report 0.
    const fresh = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 101 },
    });
    const newId = fresh.id;

    // Prime the cache: count = 0.
    const first = await request(app.getHttpServer()).get(
      `/matches/${newId}/predictions/count`,
    );
    expect(first.status).toBe(200);
    expect(first.body.count).toBe(0);

    // Mint a fresh user + token (the suite's existing users already wrote
    // for matchId, not newId, so we need a clean writer).
    const stamp = (Date.now() + 99) % 90_000_000;
    const passwordHash = await bcrypt.hash('cache-invalidation-test', 4);
    const writer = await prisma.user.create({
      data: {
        dni: String(40_000_000 + stamp).slice(-8),
        firstName: 'Cache',
        lastName: 'Writer',
        whatsapp: `549${String(4_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
      },
    });
    userIds.push(writer.id);
    // Multi-prode: writer needs an entry so the controller can resolve
    // the primary entry on POST /predictions/match/:matchId.
    const writerPayment = await prisma.payment.create({
      data: {
        userId: writer.id,
        amount: 10_000,
        method: 'CASH',
        status: 'APPROVED',
        paidAt: new Date(),
        completedAt: new Date(),
      },
    });
    await prisma.entry.create({
      data: {
        userId: writer.id,
        paymentId: writerPayment.id,
        position: 1,
        status: 'ACTIVE',
      },
    });
    const login = await request(app.getHttpServer()).post('/auth/login').send({
      dni: writer.dni,
      password: 'cache-invalidation-test',
    });
    expect(login.status).toBe(200);
    const writerToken: string = login.body.accessToken;

    // Force the lock window into the future just in case the seed put
    // matchNumber=101 in the past.
    if (fresh.predictionsLockAt.getTime() <= Date.now()) {
      await prisma.match.update({
        where: { id: newId },
        data: {
          predictionsLockAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      });
    }

    const post = await request(app.getHttpServer())
      .post(`/predictions/match/${newId}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send({ scoreHome: 2, scoreAway: 0 });
    expect(post.status).toBe(201);

    // Even though the GET would normally serve the cached 0 for 60 s, the
    // controller blew the key away — the next GET hits the DB and sees 1.
    const second = await request(app.getHttpServer()).get(
      `/matches/${newId}/predictions/count`,
    );
    expect(second.status).toBe(200);
    expect(second.body.count).toBe(1);
  });
});
