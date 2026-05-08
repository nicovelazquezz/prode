import request from 'supertest';
import {
  ADMIN_LOGIN,
  createE2EApp,
  uniqueDni,
  uniqueWhatsapp,
  type E2EAppHandles,
} from '../helpers/e2e-app.js';
import { AuthService } from '../../modules/auth/auth.service.js';

/**
 * E2E del flow de scoring de pronósticos especiales (`PUT
 * /admin/tournament-results`). Cobertura:
 *
 *   1. Setup con 4 entries distintas + sus SpecialPrediction:
 *      - "all-correct"  → debería sacar el máximo (25+12+8+15+10 = 70).
 *      - "champion-only" → solo acertó el campeón (25 pts).
 *      - "totals-close"  → totalGoals dentro de ±5 pero no exacto (5 pts).
 *      - "all-wrong"     → cero puntos.
 *   2. Admin llama PUT con los resultados oficiales.
 *   3. Verificamos:
 *      - SpecialPrediction de cada entry tiene los puntos esperados.
 *      - `totalPoints` es la suma correcta de los 5 sub-points.
 *      - `evaluatedAt` quedó seteado.
 *      - El audit log `tournament.specials_scored` quedó escrito.
 *      - El response del endpoint tiene `evaluated=4`,
 *        `totalPointsDistributed=70+25+5+0=100` y el breakdown correcto.
 *   4. Idempotencia: re-llamar con OTROS resultados re-puntúa todo
 *      sobreescribiendo los valores previos.
 *   5. Validaciones: 400 para teams duplicados, ids inexistentes,
 *      totalGoals negativo. 401 sin token. 403 con token de USER.
 */
describe('PUT /admin/tournament-results (e2e)', () => {
  let h: E2EAppHandles;
  let auth: AuthService;
  let adminToken: string;

  // Setup state
  let teamArgentina: string;
  let teamFrance: string;
  let teamCroatia: string;
  let teamMorocco: string;
  let goleadorMessi: string;
  let goleadorMbappe: string;

  // 4 entries distintas con sus specials
  let entryAllCorrect: string;
  let entryChampionOnly: string;
  let entryTotalsClose: string;
  let entryAllWrong: string;

  // User regular (para verificar 403)
  let userToken: string;

  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    h = await createE2EApp();
    await h.cleanDb();
    auth = h.app.get(AuthService);

    const adminLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send(ADMIN_LOGIN);
    if (adminLogin.status !== 200) {
      throw new Error(
        `Admin login failed (${adminLogin.status}): ${JSON.stringify(adminLogin.body)}`,
      );
    }
    adminToken = adminLogin.body.accessToken;

    // Reusamos 4 teams existentes del seed (suficiente para distinguir
    // los 4 picks) en vez de crear nuevos — los teams del seed están
    // FK'd a partidos y no querés tocarlos.
    const teams = await h.prisma.team.findMany({ take: 4 });
    if (teams.length < 4) {
      throw new Error(
        'Seed insuficiente: se necesitan al menos 4 teams para este test',
      );
    }
    teamArgentina = teams[0]!.id;
    teamFrance = teams[1]!.id;
    teamCroatia = teams[2]!.id;
    teamMorocco = teams[3]!.id;

    // Misma lógica con players. Necesitamos 2 players válidos para
    // distinguir el goleador real del que adivinaron mal los entries.
    const players = await h.prisma.player.findMany({ take: 2 });
    if (players.length < 2) {
      throw new Error(
        'Seed insuficiente: se necesitan al menos 2 players para este test',
      );
    }
    goleadorMessi = players[0]!.id;
    goleadorMbappe = players[1]!.id;

    // Provisión de 4 users + 4 entries + sus specials.
    const passwordHash = await auth.hashPassword('whatever1');
    async function makeEntry(specialOverrides: {
      championTeamId: string;
      runnerUpTeamId: string;
      thirdPlaceTeamId: string;
      topScorerId: string;
      totalGoals: number;
    }): Promise<string> {
      const user = await h.prisma.user.create({
        data: {
          dni: uniqueDni(),
          firstName: 'Tester',
          lastName: 'Specials',
          whatsapp: uniqueWhatsapp(),
          passwordHash,
          role: 'USER',
          status: 'ACTIVE',
        },
      });
      const payment = await h.prisma.payment.create({
        data: {
          userId: user.id,
          amount: 10_000,
          method: 'CASH',
          status: 'APPROVED',
          paidAt: new Date(),
          completedAt: new Date(),
        },
      });
      const entry = await h.prisma.entry.create({
        data: {
          userId: user.id,
          paymentId: payment.id,
          position: 1,
          status: 'ACTIVE',
        },
      });
      await h.prisma.specialPrediction.create({
        data: {
          entryId: entry.id,
          ...specialOverrides,
          // El topScorerName se guarda en el flow real; lo dejamos en
          // string del id para no acoplar a la BD de Players.
          topScorerName: specialOverrides.topScorerId,
          lockedAt: new Date(),
        },
      });
      return entry.id;
    }

    // Resultado oficial que voy a cargar en el test:
    //   campeón=Argentina · sub=Francia · 3°=Croacia · goleador=Messi · totalGoals=170
    entryAllCorrect = await makeEntry({
      championTeamId: teamArgentina,
      runnerUpTeamId: teamFrance,
      thirdPlaceTeamId: teamCroatia,
      topScorerId: goleadorMessi,
      totalGoals: 170,
    });
    entryChampionOnly = await makeEntry({
      championTeamId: teamArgentina,
      runnerUpTeamId: teamMorocco, // mal
      thirdPlaceTeamId: teamMorocco, // mal (no chocará con runnerUp porque son entries distintas)
      topScorerId: goleadorMbappe, // mal
      totalGoals: 200, // > 5 de diferencia
    });
    entryTotalsClose = await makeEntry({
      championTeamId: teamMorocco, // mal
      runnerUpTeamId: teamMorocco, // mal
      thirdPlaceTeamId: teamMorocco, // mal
      topScorerId: goleadorMbappe, // mal
      totalGoals: 173, // diff=3 → close
    });
    entryAllWrong = await makeEntry({
      championTeamId: teamMorocco,
      runnerUpTeamId: teamMorocco,
      thirdPlaceTeamId: teamMorocco,
      topScorerId: goleadorMbappe,
      totalGoals: 100, // diff=70 → 0
    });

    // User regular para el test de 403.
    const userDni = uniqueDni();
    await h.prisma.user.create({
      data: {
        dni: userDni,
        firstName: 'Regular',
        lastName: 'User',
        whatsapp: uniqueWhatsapp(),
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    const userLogin = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send({ dni: userDni, password: 'whatever1' });
    userToken = userLogin.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    if (h?.cleanDb) await h.cleanDb();
    if (h?.closeApp) await h.closeApp();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }, 30_000);

  it('puntúa todos los SpecialPrediction según los resultados oficiales', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [goleadorMessi],
        totalGoals: 170,
      });

    expect(res.status).toBe(200);
    expect(res.body.evaluated).toBe(4);
    // Suma esperada: 70 + 25 + 5 + 0 = 100
    expect(res.body.totalPointsDistributed).toBe(100);
    expect(res.body.breakdown).toEqual({
      champion: 2, // all-correct + champion-only
      runnerUp: 1, // solo all-correct
      thirdPlace: 1, // solo all-correct
      topScorer: 1, // solo all-correct
      totalGoalsExact: 1, // solo all-correct
      totalGoalsClose: 1, // solo totals-close
    });

    // Verificamos cada entry individualmente
    const all = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryAllCorrect },
    });
    expect(all?.championPoints).toBe(25);
    expect(all?.runnerUpPoints).toBe(12);
    expect(all?.thirdPlacePoints).toBe(8);
    expect(all?.topScorerPoints).toBe(15);
    expect(all?.totalGoalsPoints).toBe(10);
    expect(all?.totalPoints).toBe(70);
    expect(all?.evaluatedAt).toBeInstanceOf(Date);

    const champ = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryChampionOnly },
    });
    expect(champ?.championPoints).toBe(25);
    expect(champ?.runnerUpPoints).toBe(0);
    expect(champ?.thirdPlacePoints).toBe(0);
    expect(champ?.topScorerPoints).toBe(0);
    expect(champ?.totalGoalsPoints).toBe(0);
    expect(champ?.totalPoints).toBe(25);

    const close = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryTotalsClose },
    });
    expect(close?.championPoints).toBe(0);
    expect(close?.totalGoalsPoints).toBe(5); // diff=3 → close
    expect(close?.totalPoints).toBe(5);

    const wrong = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryAllWrong },
    });
    expect(wrong?.totalPoints).toBe(0);
    expect(wrong?.evaluatedAt).toBeInstanceOf(Date);
  });

  it('escribió un audit log tournament.specials_scored', async () => {
    const audit = await h.prisma.auditLog.findFirst({
      where: { action: 'tournament.specials_scored' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entity).toBe('tournament');
    expect(audit?.entityId).toBe('world-cup-2026');
    const changes = audit?.changes as { evaluated: number };
    expect(changes.evaluated).toBe(4);
  });

  it('es idempotente — re-llamar con resultados distintos sobreescribe', async () => {
    // Cargamos un resultado totalmente distinto
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: teamMorocco,
        runnerUpTeamId: teamCroatia,
        thirdPlaceTeamId: teamArgentina,
        topScorerIds: [goleadorMbappe],
        totalGoals: 100,
      });
    expect(res.status).toBe(200);

    // El nuevo resultado oficial es:
    //   campeón=Morocco · sub=Croacia · 3°=Argentina · goleador=Mbappe · totalGoals=100
    //
    // "all-correct" tenía: campeón=Argentina, sub=Francia, 3°=Croacia,
    //   goleador=Messi, totalGoals=170. Vs el nuevo resultado, NADA
    //   coincide → 0 pts. (Su totalGoals=170 vs results=100, diff=70 → 0.)
    const all = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryAllCorrect },
    });
    expect(all?.totalPoints).toBe(0);

    // "all-wrong" tenía: campeón=Morocco, sub=Morocco, 3°=Morocco,
    //   goleador=Mbappe, totalGoals=100. Vs el nuevo resultado:
    //     campeón Morocco === Morocco → 25
    //     sub Morocco !== Croacia       → 0
    //     3° Morocco !== Argentina      → 0
    //     goleador Mbappe === Mbappe    → 15
    //     totalGoals 100 === 100         → 10
    //   total = 50. Demuestra que el endpoint es idempotente: la 2ª
    //   llamada con resultados distintos re-puntúa desde cero.
    const wrong = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryAllWrong },
    });
    expect(wrong?.championPoints).toBe(25);
    expect(wrong?.runnerUpPoints).toBe(0);
    expect(wrong?.thirdPlacePoints).toBe(0);
    expect(wrong?.topScorerPoints).toBe(15);
    expect(wrong?.totalGoalsPoints).toBe(10);
    expect(wrong?.totalPoints).toBe(50);
  });

  it('rechaza 3 teams iguales en el podio con 400', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamArgentina,
        thirdPlaceTeamId: teamArgentina,
        topScorerIds: [goleadorMessi],
        totalGoals: 170,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/distintos/i);
  });

  it('rechaza ids inexistentes con 400', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: 'cuid_no_existe_team_xx',
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [goleadorMessi],
        totalGoals: 170,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no existen|championTeamId/i);
  });

  it('rechaza totalGoals negativo con 400 (DTO validation)', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [goleadorMessi],
        totalGoals: -5,
      });
    expect(res.status).toBe(400);
  });

  it('devuelve 401 sin Authorization header', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [goleadorMessi],
        totalGoals: 170,
      });
    expect(res.status).toBe(401);
  });

  it('devuelve 403 con un token de role=USER', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [goleadorMessi],
        totalGoals: 170,
      });
    expect(res.status).toBe(403);
  });

  it('empate de goleador: ambos jugadores válidos suman puntos al user que pickeó cualquiera', async () => {
    // Reseteamos los puntos de las 4 entries para empezar limpio.
    await h.prisma.specialPrediction.updateMany({
      data: {
        topScorerPoints: 0,
        championPoints: 0,
        runnerUpPoints: 0,
        thirdPlacePoints: 0,
        totalGoalsPoints: 0,
        totalPoints: 0,
      },
    });

    // Resultado oficial con empate de goleador: Messi y Mbappe quedan
    // empatados como goleadores del torneo. Cualquier user que pickeó
    // a uno de los dos debe sumar.
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [goleadorMessi, goleadorMbappe],
        totalGoals: 170,
      });

    expect(res.status).toBe(200);
    // 4 entries puntuadas: 2 que pickearon Messi (allCorrect) o Mbappe
    // (championOnly, totalsClose, allWrong). Los 4 deberían cobrar
    // topScorer porque cada uno pickeó uno de los empatados.
    expect(res.body.breakdown.topScorer).toBe(4);

    // Verificamos puntos individuales del topScorer
    const all = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryAllCorrect },
    });
    expect(all?.topScorerPoints).toBe(15); // pickeó Messi
    const champ = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryChampionOnly },
    });
    expect(champ?.topScorerPoints).toBe(15); // pickeó Mbappe → válido por empate
    const close = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryTotalsClose },
    });
    expect(close?.topScorerPoints).toBe(15); // pickeó Mbappe
    const wrong = await h.prisma.specialPrediction.findUnique({
      where: { entryId: entryAllWrong },
    });
    expect(wrong?.topScorerPoints).toBe(15); // pickeó Mbappe
  });

  it('rechaza topScorerIds vacío con 400', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [],
        totalGoals: 170,
      });
    expect(res.status).toBe(400);
  });

  it('rechaza topScorerIds con duplicados con 400', async () => {
    const res = await request(h.app.getHttpServer())
      .put('/admin/tournament-results')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        championTeamId: teamArgentina,
        runnerUpTeamId: teamFrance,
        thirdPlaceTeamId: teamCroatia,
        topScorerIds: [goleadorMessi, goleadorMessi],
        totalGoals: 170,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/repetidos/i);
  });
});
