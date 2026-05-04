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
      await prisma.prediction.create({
        data: { userId: user.id, matchId, scoreHome: 1, scoreAway: i },
      });
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      if (userIds.length > 0) {
        await prisma.prediction.deleteMany({
          where: { userId: { in: userIds } },
        });
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
});
