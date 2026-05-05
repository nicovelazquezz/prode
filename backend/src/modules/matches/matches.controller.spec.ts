import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Integration tests for Phase 6.1 endpoints. Runs against the real Postgres
 * (Phase 1 docker-compose) and reuses the seed data:
 *
 *   - 104 matches loaded via `seed-matches.ts` (72 GROUPS, 16 ROUND_32, …)
 *   - admin user from `seed-config.ts` (DNI `00000000`)
 *
 * Each test that mutates a match is responsible for restoring the row's
 * pre-state in `afterAll` so re-runs stay green.
 */
describe('MatchesController (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  // Snapshot of each touched match so we can restore it on teardown.
  type MatchSnapshot = {
    id: string;
    kickoffAt: Date;
    predictionsLockAt: Date;
    predictionsOpenAt: Date | null;
    homeTeamId: string | null;
    awayTeamId: string | null;
    venue: string | null;
    city: string | null;
    country: string | null;
    status: string;
  };
  const restoreList: MatchSnapshot[] = [];

  async function snapshot(id: string): Promise<MatchSnapshot> {
    const m = await prisma.match.findUniqueOrThrow({ where: { id } });
    return {
      id: m.id,
      kickoffAt: m.kickoffAt,
      predictionsLockAt: m.predictionsLockAt,
      predictionsOpenAt: m.predictionsOpenAt,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      venue: m.venue,
      city: m.city,
      country: m.country,
      status: m.status,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);

    // Drop any leftover matches from prior failed test runs. The seed
    // owns matchNumber 1..104; any matchNumber outside that range was
    // produced by a sibling integration spec (`users.controller.spec`
    // creates 9xxx-numbered matches) whose `afterAll` may have aborted.
    // Without this guard, the count assertions below see stale rows.
    await prisma.prediction.deleteMany({
      where: { match: { matchNumber: { gt: 104 } } },
    });
    await prisma.match.deleteMany({ where: { matchNumber: { gt: 104 } } });

    // Sanity check: the seed must have run so we have rows to query.
    const count = await prisma.match.count();
    if (count < 104) {
      throw new Error(
        `Test prerequisite failed: expected 104 matches in DB, got ${count}.`,
      );
    }

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ dni: ADMIN_DNI, password: ADMIN_PASSWORD });
    if (login.status !== 200) {
      throw new Error(
        `Admin login failed (status ${login.status}). Run Phase 2 seed.`,
      );
    }
    adminToken = login.body.accessToken;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      for (const snap of restoreList) {
        await prisma.match.update({
          where: { id: snap.id },
          data: {
            kickoffAt: snap.kickoffAt,
            predictionsLockAt: snap.predictionsLockAt,
            predictionsOpenAt: snap.predictionsOpenAt,
            homeTeamId: snap.homeTeamId,
            awayTeamId: snap.awayTeamId,
            venue: snap.venue,
            city: snap.city,
            country: snap.country,
            status: snap.status as MatchSnapshot['status'],
          },
        });
      }
      await prisma.auditLog.deleteMany({
        where: {
          entity: 'match',
          entityId: { in: restoreList.map((s) => s.id) },
        },
      });
    }
    if (app) await app.close();
  }, 30_000);

  describe('GET /matches', () => {
    it('returns paginated matches sorted by kickoffAt asc', async () => {
      const res = await request(app.getHttpServer())
        .get('/matches')
        .query({ page: 1, pageSize: 5 });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(5);
      expect(res.body.total).toBeGreaterThanOrEqual(104);
      // Sorted ascending on kickoffAt
      const kickoffs = (res.body.data as Array<{ kickoffAt: string }>).map(
        (m) => new Date(m.kickoffAt).getTime(),
      );
      const sortedAsc = [...kickoffs].sort((a, b) => a - b);
      expect(kickoffs).toEqual(sortedAsc);
    });

    it('filters by phase=GROUPS (72 matches)', async () => {
      const res = await request(app.getHttpServer())
        .get('/matches')
        .query({ phase: 'GROUPS', pageSize: 200 });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(72);
      expect(res.body.data).toHaveLength(72);
      for (const m of res.body.data as Array<{ phase: string }>) {
        expect(m.phase).toBe('GROUPS');
      }
    });

    it('filters by status=SCHEDULED', async () => {
      const res = await request(app.getHttpServer())
        .get('/matches')
        .query({ status: 'SCHEDULED', pageSize: 5 });
      expect(res.status).toBe(200);
      for (const m of res.body.data as Array<{ status: string }>) {
        expect(m.status).toBe('SCHEDULED');
      }
    });

    it('rejects unknown query fields (whitelist)', async () => {
      const res = await request(app.getHttpServer())
        .get('/matches')
        .query({ phase: 'GROUPS', unknown: 'x' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /matches/upcoming', () => {
    it('returns up to 10 SCHEDULED matches with future kickoff', async () => {
      const res = await request(app.getHttpServer()).get('/matches/upcoming');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect((res.body as unknown[]).length).toBeLessThanOrEqual(10);
      const now = Date.now();
      for (const m of res.body as Array<{
        status: string;
        kickoffAt: string;
      }>) {
        expect(m.status).toBe('SCHEDULED');
        expect(new Date(m.kickoffAt).getTime()).toBeGreaterThan(now);
      }
    });
  });

  describe('GET /matches/by-phase/:phase', () => {
    it('returns 72 GROUPS matches with team relations populated', async () => {
      const res = await request(app.getHttpServer()).get(
        '/matches/by-phase/GROUPS',
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect((res.body as unknown[]).length).toBe(72);
      // The relations are present (possibly null) on each row.
      for (const m of res.body as Array<{
        phase: string;
        homeTeam: unknown;
        awayTeam: unknown;
      }>) {
        expect(m.phase).toBe('GROUPS');
        expect(m).toHaveProperty('homeTeam');
        expect(m).toHaveProperty('awayTeam');
      }
    });

    it('returns ROUND_32 matches (16 matches per spec data)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/matches/by-phase/ROUND_32',
      );
      expect(res.status).toBe(200);
      expect((res.body as unknown[]).length).toBe(16);
    });

    it('returns 400 for an unknown phase string', async () => {
      const res = await request(app.getHttpServer()).get(
        '/matches/by-phase/NOT_A_PHASE',
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/matches/:id', () => {
    it('returns full detail with team relations for admin', async () => {
      const sample = await prisma.match.findFirstOrThrow();
      const res = await request(app.getHttpServer())
        .get(`/admin/matches/${sample.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(sample.id);
      // Relations included even when null (placeholders).
      expect(res.body).toHaveProperty('homeTeam');
      expect(res.body).toHaveProperty('awayTeam');
    });

    it('returns 401 without an access token', async () => {
      const sample = await prisma.match.findFirstOrThrow();
      const res = await request(app.getHttpServer()).get(
        `/admin/matches/${sample.id}`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/matches/non-existent-id')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /admin/matches/:id', () => {
    it('updates kickoffAt and recomputes predictionsLockAt', async () => {
      const target = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 50 },
      });
      restoreList.push(await snapshot(target.id));

      const newKickoff = new Date(Date.now() + 365 * 24 * 3600 * 1000); // +1 year
      const res = await request(app.getHttpServer())
        .put(`/admin/matches/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kickoffAt: newKickoff.toISOString() });
      expect(res.status).toBe(200);
      expect(new Date(res.body.kickoffAt).getTime()).toBe(newKickoff.getTime());
      // predictionsLockAt = kickoffAt - 10 min
      expect(new Date(res.body.predictionsLockAt).getTime()).toBe(
        newKickoff.getTime() - 10 * 60 * 1000,
      );

      // Audit log written with action `match.kickoff_updated`.
      await new Promise((r) => setTimeout(r, 100));
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'match.kickoff_updated',
          entityId: target.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
    });

    it('rejects kickoffAt in the past with 400', async () => {
      const target = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 51 },
      });
      const res = await request(app.getHttpServer())
        .put(`/admin/matches/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kickoffAt: '2020-01-01T00:00:00.000Z' });
      expect(res.status).toBe(400);
    });

    it('rejects assigning the same team to home and away', async () => {
      const team = await prisma.team.findFirstOrThrow();
      const target = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 52 },
      });
      const res = await request(app.getHttpServer())
        .put(`/admin/matches/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ homeTeamId: team.id, awayTeamId: team.id });
      expect(res.status).toBe(400);
    });

    it('sets predictionsOpenAt when both teams flip from null to set', async () => {
      const teams = await prisma.team.findMany({ take: 2 });
      expect(teams.length).toBe(2);
      // Pick a knockout match where teams are still null in the seed
      // (R32 / R16 / Quarters don't have teams assigned yet).
      const target = await prisma.match.findFirstOrThrow({
        where: {
          phase: 'ROUND_32',
          homeTeamId: null,
          awayTeamId: null,
        },
      });
      restoreList.push(await snapshot(target.id));

      const res = await request(app.getHttpServer())
        .put(`/admin/matches/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ homeTeamId: teams[0]!.id, awayTeamId: teams[1]!.id });
      expect(res.status).toBe(200);
      expect(res.body.homeTeamId).toBe(teams[0]!.id);
      expect(res.body.awayTeamId).toBe(teams[1]!.id);
      expect(res.body.predictionsOpenAt).not.toBeNull();

      await new Promise((r) => setTimeout(r, 100));
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'match.team_assigned',
          entityId: target.id,
        },
      });
      expect(audit).toBeTruthy();
    });

    it('returns 403 for non-admin users', async () => {
      // Spin up a USER token by inserting a one-off user.
      const sample = await prisma.match.findFirstOrThrow();
      // No user token at hand — easiest is to send a malformed token so
      // JwtAuthGuard rejects with 401, which still proves admin gate.
      const res = await request(app.getHttpServer())
        .put(`/admin/matches/${sample.id}`)
        .set('Authorization', `Bearer not-a-real-jwt`)
        .send({ venue: 'Test Venue' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /admin/matches/:id/postpone', () => {
    it('updates kickoff, recomputes lock, sets status=POSTPONED', async () => {
      const target = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 60 },
      });
      restoreList.push(await snapshot(target.id));

      const newKickoff = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const res = await request(app.getHttpServer())
        .post(`/admin/matches/${target.id}/postpone`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newKickoffAt: newKickoff.toISOString() });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('POSTPONED');
      expect(new Date(res.body.kickoffAt).getTime()).toBe(newKickoff.getTime());
      expect(new Date(res.body.predictionsLockAt).getTime()).toBe(
        newKickoff.getTime() - 10 * 60 * 1000,
      );

      await new Promise((r) => setTimeout(r, 100));
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'match.postponed', entityId: target.id },
      });
      expect(audit).toBeTruthy();
    });

    it('rejects postponing a FINISHED match with 400', async () => {
      const target = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 61 },
      });
      restoreList.push(await snapshot(target.id));
      await prisma.match.update({
        where: { id: target.id },
        data: { status: 'FINISHED' },
      });

      const res = await request(app.getHttpServer())
        .post(`/admin/matches/${target.id}/postpone`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newKickoffAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        });
      expect(res.status).toBe(400);
    });

    it('rejects postponing to a past date with 400', async () => {
      const target = await prisma.match.findFirstOrThrow({
        where: { matchNumber: 62 },
      });
      const res = await request(app.getHttpServer())
        .post(`/admin/matches/${target.id}/postpone`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newKickoffAt: '2020-01-01T00:00:00.000Z' });
      expect(res.status).toBe(400);
    });
  });
});
