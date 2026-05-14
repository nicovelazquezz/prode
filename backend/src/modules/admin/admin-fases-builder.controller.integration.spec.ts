import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * HTTP integration tests for `GET /admin/fases/builder/:phase`.
 *
 * Verifica:
 *   - 401 sin auth.
 *   - ROUND_32 → 16 matches (#73-88) + reference.type === 'GROUPS' con 12
 *     entradas A..L.
 *   - ROUND_16 → 8 matches + reference.type === 'PREVIOUS_ROUND',
 *     previousPhase === 'ROUND_32', 16 matches en la lista.
 *   - FINAL → INCLUYE ambos #103 (THIRD_PLACE) y #104 (FINAL), y matchPhase
 *     distingue cada match. Reference: 2 matches de SEMIS con winner+loser.
 *   - THIRD_PLACE → 400 con mensaje específico.
 *   - GROUPS → 400.
 */
describe('GET /admin/fases/builder/:phase (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const stamp =
    (Date.now() + Math.floor(Math.random() * 1_000_000)) % 99_000_000;

  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  // Snapshot/restore para SEMIS (#101, #102): los completamos como
  // FINISHED con winnerTeamId para ejercitar el path de winner/loser
  // del reference en phase=FINAL.
  const SEMI_NUMBERS = [101, 102];
  const semiSnapshots = new Map<
    number,
    {
      status: string;
      scoreHome: number | null;
      scoreAway: number | null;
      winnerTeamId: string | null;
      finishedAt: Date | null;
      homeTeamId: string | null;
      awayTeamId: string | null;
    }
  >();

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

    // Para el caso `phase === 'FINAL'` queremos que SEMIS tenga
    // resultados (uno con ganador por penales / scores empatados, y otro
    // con scores distintos) para verificar que loser/winner se computen
    // correctamente. Snapshot + patch + restore en afterAll.
    const teams = await prisma.team.findMany({ take: 4, orderBy: { id: 'asc' } });
    if (teams.length < 4) {
      throw new Error('Seed needs at least 4 teams for SEMI fixture.');
    }
    const [tA, tB, tC, tD] = teams as [
      (typeof teams)[number],
      (typeof teams)[number],
      (typeof teams)[number],
      (typeof teams)[number],
    ];

    for (const matchNumber of SEMI_NUMBERS) {
      const m = await prisma.match.findUnique({ where: { matchNumber } });
      if (!m) throw new Error(`Match #${matchNumber} missing from seed`);
      semiSnapshots.set(matchNumber, {
        status: m.status,
        scoreHome: m.scoreHome,
        scoreAway: m.scoreAway,
        winnerTeamId: m.winnerTeamId,
        finishedAt: m.finishedAt,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
      });
    }

    // #101: 2-1 (winner por scores, sin empate). homeTeam = tA, awayTeam = tB.
    await prisma.match.update({
      where: { matchNumber: 101 },
      data: {
        homeTeamId: tA.id,
        awayTeamId: tB.id,
        scoreHome: 2,
        scoreAway: 1,
        status: 'FINISHED',
        finishedAt: new Date(),
        winnerTeamId: null,
      },
    });
    // #102: 1-1 con winnerTeamId = tC (por penales). homeTeam = tC, awayTeam = tD.
    await prisma.match.update({
      where: { matchNumber: 102 },
      data: {
        homeTeamId: tC.id,
        awayTeamId: tD.id,
        scoreHome: 1,
        scoreAway: 1,
        status: 'FINISHED',
        finishedAt: new Date(),
        winnerTeamId: tC.id,
      },
    });
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      for (const [matchNumber, snap] of semiSnapshots) {
        await prisma.match.update({
          where: { matchNumber },
          data: {
            status: snap.status as
              | 'SCHEDULED'
              | 'LOCKED'
              | 'IN_PROGRESS'
              | 'FINISHED'
              | 'POSTPONED'
              | 'CANCELLED',
            scoreHome: snap.scoreHome,
            scoreAway: snap.scoreAway,
            winnerTeamId: snap.winnerTeamId,
            finishedAt: snap.finishedAt,
            homeTeamId: snap.homeTeamId,
            awayTeamId: snap.awayTeamId,
          },
        });
      }
    }
    if (app) await app.close();
    // Unused stamp ref to silence lints if any.
    void stamp;
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer())
      .get('/admin/fases/builder/ROUND_32')
      .expect(401);
  });

  it('returns 16 ROUND_32 matches + GROUPS reference', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.phase).toBe('ROUND_32');
    expect(res.body.matches).toHaveLength(16);
    const numbers = res.body.matches.map((m: { matchNumber: number }) => m.matchNumber);
    expect(numbers).toEqual([73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88]);
    for (const m of res.body.matches) {
      expect(m.matchPhase).toBe('ROUND_32');
      expect(typeof m.matchId).toBe('string');
      expect(typeof m.kickoffAt).toBe('string');
      expect(m).toHaveProperty('homeTeamLabel');
      expect(m).toHaveProperty('awayTeamLabel');
    }

    expect(res.body.reference.type).toBe('GROUPS');
    const standings = res.body.reference.standings;
    expect(Object.keys(standings).sort()).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
    ]);
    for (const code of Object.keys(standings)) {
      expect(standings[code]).toHaveLength(4);
    }
  });

  it('returns 8 ROUND_16 matches + PREVIOUS_ROUND reference (16 R32 matches)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/fases/builder/ROUND_16')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.phase).toBe('ROUND_16');
    expect(res.body.matches).toHaveLength(8);
    const numbers = res.body.matches.map((m: { matchNumber: number }) => m.matchNumber);
    expect(numbers).toEqual([89, 90, 91, 92, 93, 94, 95, 96]);
    for (const m of res.body.matches) {
      expect(m.matchPhase).toBe('ROUND_16');
    }

    expect(res.body.reference.type).toBe('PREVIOUS_ROUND');
    expect(res.body.reference.previousPhase).toBe('ROUND_32');
    expect(res.body.reference.matches).toHaveLength(16);
    // Estructura de cada item: matchNumber + (home/away nullable como
    // objetos cuando los teams están seteados) + winner/loser nullable.
    for (const ref of res.body.reference.matches) {
      expect(typeof ref.matchNumber).toBe('number');
      expect(ref).toHaveProperty('homeTeam');
      expect(ref).toHaveProperty('awayTeam');
      expect(ref).toHaveProperty('winner');
      expect(ref).toHaveProperty('loser');
      expect(ref).toHaveProperty('status');
    }
  });

  it('returns BOTH THIRD_PLACE and FINAL matches when phase=FINAL', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/fases/builder/FINAL')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.phase).toBe('FINAL');
    expect(res.body.matches).toHaveLength(2);
    const phases = res.body.matches.map((m: { matchPhase: string }) => m.matchPhase).sort();
    expect(phases).toEqual(['FINAL', 'THIRD_PLACE']);
    const m103 = res.body.matches.find(
      (m: { matchNumber: number }) => m.matchNumber === 103,
    );
    const m104 = res.body.matches.find(
      (m: { matchNumber: number }) => m.matchNumber === 104,
    );
    expect(m103.matchPhase).toBe('THIRD_PLACE');
    expect(m104.matchPhase).toBe('FINAL');

    // Reference: 2 matches SEMIS.
    expect(res.body.reference.type).toBe('PREVIOUS_ROUND');
    expect(res.body.reference.previousPhase).toBe('SEMIS');
    expect(res.body.reference.matches).toHaveLength(2);

    const semis = res.body.reference.matches;
    // El semi #101 tiene 2-1 → winner = homeTeam, loser = awayTeam
    // (derivado de scores, sin winnerTeamId).
    const s101 = semis.find((s: { matchNumber: number }) => s.matchNumber === 101);
    expect(s101.scoreHome).toBe(2);
    expect(s101.scoreAway).toBe(1);
    expect(s101.winner).not.toBeNull();
    expect(s101.loser).not.toBeNull();
    expect(s101.winner.id).toBe(s101.homeTeam.id);
    expect(s101.loser.id).toBe(s101.awayTeam.id);

    // El semi #102 tiene 1-1 con winnerTeamId = homeTeam (por penales).
    const s102 = semis.find((s: { matchNumber: number }) => s.matchNumber === 102);
    expect(s102.scoreHome).toBe(1);
    expect(s102.scoreAway).toBe(1);
    expect(s102.winner).not.toBeNull();
    expect(s102.loser).not.toBeNull();
    expect(s102.winner.id).toBe(s102.homeTeam.id);
    expect(s102.loser.id).toBe(s102.awayTeam.id);
  });

  it('rejects phase=THIRD_PLACE with 400 and specific message', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/fases/builder/THIRD_PLACE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('FINAL');
  });

  it('rejects phase=GROUPS with 400', async () => {
    await request(app.getHttpServer())
      .get('/admin/fases/builder/GROUPS')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
