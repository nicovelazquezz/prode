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

/**
 * HTTP integration tests for `POST /admin/fases/builder/:phase`.
 *
 * Pruebas que validan:
 *   - Persistencia de 16 cruces R32 + `predictionsOpenAt = now` sólo
 *     cuando home y away son no-null y al menos uno estaba en null
 *     antes. Se escribe un único `auditLog` con todos los diffs.
 *   - Rechazo (400) cuando un equipo aparece en dos cruces.
 *   - Rechazo (400) cuando home === away dentro de un mismo cruce.
 *   - 401 sin token.
 *   - Rechazo (400) cuando un matchId no pertenece a la fase.
 *   - Idempotencia: re-enviar el mismo body → `matchesUpdated: 0`,
 *     sin segundo auditLog.
 *   - `predictionsOpenAt` NO se resetea si el match ya lo tenía seteado.
 *   - El auditLog se escribe SÓLO cuando hay diffs reales.
 *
 * Snapshot/restore: los 16 R32 (#73-88) parten con homeTeamId/awayTeamId
 * en `null` y `predictionsOpenAt` en `null`. Cada test que muta restaura
 * al cleanup. Para no chocar entre tests, se usa un `beforeEach` que
 * deja R32 limpio y un `afterAll` que restaura el snapshot original.
 */
describe('POST /admin/fases/builder/:phase (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const ADMIN_DNI = process.env.ADMIN_DEFAULT_DNI ?? '00000000';
  const ADMIN_PASSWORD =
    process.env.ADMIN_DEFAULT_PASSWORD ?? 'ChangeMe_DevOnly!';

  const R32_NUMBERS = Array.from({ length: 16 }, (_, i) => 73 + i);
  // Snapshot del estado original de los 16 R32 para restaurar al finalizar
  // (los tests resetean a "limpio" via beforeEach, pero el snapshot original
  // garantiza que devolvemos cualquier estado pre-existente en el seed).
  const r32Snapshots = new Map<
    number,
    {
      homeTeamId: string | null;
      awayTeamId: string | null;
      predictionsOpenAt: Date | null;
    }
  >();
  let teamIds: string[] = [];
  // Ids de auditLog creados por los tests, para limpiar al final.
  const createdAuditIds: string[] = [];

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

    const teams = await prisma.team.findMany({
      take: 32,
      orderBy: { id: 'asc' },
    });
    if (teams.length < 32) {
      throw new Error(
        `Seed needs at least 32 teams for builder fixture (found ${teams.length}).`,
      );
    }
    teamIds = teams.map((t) => t.id);

    for (const matchNumber of R32_NUMBERS) {
      const m = await prisma.match.findUnique({ where: { matchNumber } });
      if (!m) throw new Error(`Match #${matchNumber} missing from seed`);
      r32Snapshots.set(matchNumber, {
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        predictionsOpenAt: m.predictionsOpenAt,
      });
    }
  }, 30_000);

  beforeEach(async () => {
    // Limpia R32: homeTeamId/awayTeamId/predictionsOpenAt todos en null.
    for (const matchNumber of R32_NUMBERS) {
      await prisma.match.update({
        where: { matchNumber },
        data: {
          homeTeamId: null,
          awayTeamId: null,
          predictionsOpenAt: null,
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      // Borrar auditLogs creados por los tests.
      if (createdAuditIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { id: { in: createdAuditIds } },
        });
      }
      // Restaurar snapshots originales.
      for (const [matchNumber, snap] of r32Snapshots) {
        await prisma.match.update({
          where: { matchNumber },
          data: {
            homeTeamId: snap.homeTeamId,
            awayTeamId: snap.awayTeamId,
            predictionsOpenAt: snap.predictionsOpenAt,
          },
        });
      }
    }
    if (app) await app.close();
  });

  /**
   * Construye un body que asigna los 16 R32 con pares
   * (team[0], team[1]), (team[2], team[3])... a partir de matchIds reales
   * de la BD.
   */
  async function buildSixteenR32Body(): Promise<{
    matchIds: string[];
    body: {
      matches: Array<{
        matchId: string;
        homeTeamId: string;
        awayTeamId: string;
      }>;
    };
  }> {
    const r32 = await prisma.match.findMany({
      where: { matchNumber: { in: R32_NUMBERS } },
      orderBy: { matchNumber: 'asc' },
      select: { id: true },
    });
    const matchIds = r32.map((m) => m.id);
    const body = {
      matches: matchIds.map((id, i) => ({
        matchId: id,
        homeTeamId: teamIds[i * 2]!,
        awayTeamId: teamIds[i * 2 + 1]!,
      })),
    };
    return { matchIds, body };
  }

  // Helper que captura auditLogs creados durante un POST y los suma a
  // la lista de cleanup. Filtra por action='phase.builder.applied'.
  async function snapshotNewAuditIds(prevIds: Set<string>): Promise<string[]> {
    const logs = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    const newOnes = logs
      .filter((l) => !prevIds.has(l.id))
      .map((l) => l.id);
    createdAuditIds.push(...newOnes);
    return newOnes;
  }

  it('rejects unauthenticated requests with 401', async () => {
    const { body } = await buildSixteenR32Body();
    await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .send(body)
      .expect(401);
  });

  it('persists 16 R32 cruces, sets predictionsOpenAt, writes single audit log', async () => {
    const before = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    const beforeIds = new Set(before.map((l) => l.id));

    const { body } = await buildSixteenR32Body();

    const res = await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.matchesUpdated).toBe(16);

    // Cada match tiene los teams asignados y predictionsOpenAt seteado.
    const updated = await prisma.match.findMany({
      where: { matchNumber: { in: R32_NUMBERS } },
      orderBy: { matchNumber: 'asc' },
    });
    expect(updated).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      const m = updated[i]!;
      expect(m.homeTeamId).toBe(teamIds[i * 2]);
      expect(m.awayTeamId).toBe(teamIds[i * 2 + 1]);
      expect(m.predictionsOpenAt).not.toBeNull();
    }

    // Un único auditLog nuevo.
    const newIds = await snapshotNewAuditIds(beforeIds);
    expect(newIds).toHaveLength(1);
  });

  it('rejects duplicate team across crosses with 400', async () => {
    const { body } = await buildSixteenR32Body();
    // Forzamos que team[0] aparezca también en el segundo cruce como home.
    body.matches[1]!.homeTeamId = body.matches[0]!.homeTeamId;

    await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(400);
  });

  it('rejects home === away within a single match with 400', async () => {
    const { body } = await buildSixteenR32Body();
    body.matches[0]!.awayTeamId = body.matches[0]!.homeTeamId;
    // Como ahora hay 2 equipos repetidos en el mismo cruce, el chequeo
    // home===away dispara primero. Pero también ajustamos el resto para
    // evitar conflicto de equipo duplicado entre cruces.
    body.matches[1]!.homeTeamId = teamIds[2]!;
    body.matches[1]!.awayTeamId = teamIds[3]!;

    await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(400);
  });

  it('rejects matchId that does not belong to the phase with 400', async () => {
    const { body } = await buildSixteenR32Body();
    // Buscamos un match de GROUPS (no R32) para usarlo como id inválido.
    const groupsMatch = await prisma.match.findFirst({
      where: { phase: 'GROUPS' },
      select: { id: true },
    });
    if (!groupsMatch) throw new Error('Seed missing GROUPS matches');
    body.matches[0]!.matchId = groupsMatch.id;

    await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(400);
  });

  it('is idempotent: second call returns matchesUpdated=0 with no extra audit log', async () => {
    const before = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    const beforeIds = new Set(before.map((l) => l.id));

    const { body } = await buildSixteenR32Body();

    await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);

    const afterFirst = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    const afterFirstIds = new Set(afterFirst.map((l) => l.id));

    // Segundo POST con el MISMO body.
    const res2 = await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    expect(res2.body.matchesUpdated).toBe(0);

    const afterSecond = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    // No nuevos audit logs respecto al primer POST.
    expect(afterSecond.length).toBe(afterFirstIds.size);

    // Tracking de cleanup.
    await snapshotNewAuditIds(beforeIds);
  });

  it('does NOT reset predictionsOpenAt when overwriting an already-populated match', async () => {
    const before = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    const beforeIds = new Set(before.map((l) => l.id));

    // Pre-seed: match #73 ya tiene ambos teams + predictionsOpenAt seteado.
    const fixedOpenAt = new Date('2026-05-01T00:00:00.000Z');
    const m73Initial = await prisma.match.update({
      where: { matchNumber: 73 },
      data: {
        homeTeamId: teamIds[0]!,
        awayTeamId: teamIds[1]!,
        predictionsOpenAt: fixedOpenAt,
      },
    });

    // Cambiamos away por otro team — predictionsOpenAt no debe moverse.
    const { body } = await buildSixteenR32Body();
    // En body.matches[0] (matchId = match #73) ajustamos para que cambie
    // el away pero el home siga siendo team[0]:
    body.matches[0] = {
      matchId: m73Initial.id,
      homeTeamId: teamIds[0]!,
      awayTeamId: teamIds[30]!, // distinto a teamIds[1]
    };
    // El resto del body usa pares desde teamIds[2], y debemos asegurar
    // que teamIds[30] no aparezca duplicado. buildSixteenR32Body usa
    // teamIds[0..31] secuenciales; teamIds[30] ya está asignado al cruce
    // #88 (i=15: home=teamIds[30], away=teamIds[31]). Ajustamos #88 para
    // evitar duplicado.
    body.matches[15] = {
      matchId: body.matches[15]!.matchId,
      homeTeamId: teamIds[1]!, // libre porque sacamos a teamIds[1] del cruce #73
      awayTeamId: teamIds[31]!,
    };

    await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);

    const m73After = await prisma.match.findUnique({
      where: { matchNumber: 73 },
    });
    expect(m73After?.awayTeamId).toBe(teamIds[30]);
    expect(m73After?.predictionsOpenAt?.toISOString()).toBe(
      fixedOpenAt.toISOString(),
    );

    await snapshotNewAuditIds(beforeIds);
  });

  it('writes audit log only when there are real diffs', async () => {
    // Pre-seed: match #73 ya tiene los mismos teams que vamos a postear.
    const m73 = await prisma.match.findUnique({ where: { matchNumber: 73 } });
    if (!m73) throw new Error('Seed missing match #73');
    await prisma.match.update({
      where: { matchNumber: 73 },
      data: {
        homeTeamId: teamIds[0]!,
        awayTeamId: teamIds[1]!,
        predictionsOpenAt: new Date(),
      },
    });

    const before = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    const beforeCount = before.length;

    // Posteamos UN solo match con los mismos teams → no hay diff.
    const body = {
      matches: [
        {
          matchId: m73.id,
          homeTeamId: teamIds[0]!,
          awayTeamId: teamIds[1]!,
        },
      ],
    };
    const res = await request(app.getHttpServer())
      .post('/admin/fases/builder/ROUND_32')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    expect(res.body.matchesUpdated).toBe(0);

    const after = await prisma.auditLog.findMany({
      where: { action: 'phase.builder.applied' },
      select: { id: true },
    });
    expect(after.length).toBe(beforeCount);
  });
});
