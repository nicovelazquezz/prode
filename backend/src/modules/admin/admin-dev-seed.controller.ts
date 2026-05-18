// Dev-only convenience endpoints to run the prisma/seed-*.ts scripts in
// production environments where `npx tsx` is not viable (Dokploy terminal
// can't write to npm cache, session env quirks, etc.).
//
// Guarded by RolesGuard + @Roles('ADMIN'). Call one at a time with curl.
//
//   POST /admin/dev/seed/teams      ← seed-teams.ts
//   POST /admin/dev/seed/config     ← seed-config.ts (sin bootstrap admin user)
//   POST /admin/dev/seed/matches    ← seed-matches.ts
//   POST /admin/dev/seed/demo       ← seed-demo.ts
//
// Logic is inlined verbatim from prisma/seed-*.ts — keep both in sync.
import {
  BadRequestException,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

const PRISMA_DATA_DIR = process.env.PRISMA_DATA_DIR ?? '/app/prisma/data';

// ─── Types mirrored from seed-teams.ts / seed-matches.ts ─────────────────

type SeedTeam = {
  fifaCode: string;
  name: string;
  shortName: string;
  flagUrl: string;
  confederation: 'CONMEBOL' | 'UEFA' | 'CONCACAF' | 'AFC' | 'CAF' | 'OFC';
  groupCode: string | null;
  fifaRanking: number | null;
};

type SeedMatch = {
  matchNumber: number;
  phase:
    | 'GROUPS'
    | 'ROUND_32'
    | 'ROUND_16'
    | 'QUARTERS'
    | 'SEMIS'
    | 'THIRD_PLACE'
    | 'FINAL';
  groupCode: string | null;
  homeTeamLabel: string;
  awayTeamLabel: string;
  kickoffAt: string;
  predictionsLockAt: string;
  venue: string;
  city: string;
  country: string;
};

// ─── Config defaults (copied from seed-config.ts) ────────────────────────

const SCORING_RULES: Array<{
  outcomeType:
    | 'EXACT'
    | 'WINNER_AND_DIFF'
    | 'DRAW_DIFFERENT'
    | 'WINNER_ONLY'
    | 'MISS';
  basePoints: number;
  description: string;
}> = [
  { outcomeType: 'EXACT', basePoints: 5, description: 'Resultado exacto' },
  { outcomeType: 'WINNER_AND_DIFF', basePoints: 3, description: 'Ganador correcto y misma diferencia de gol' },
  { outcomeType: 'DRAW_DIFFERENT', basePoints: 2, description: 'Empate acertado pero con marcador distinto' },
  { outcomeType: 'WINNER_ONLY', basePoints: 1, description: 'Ganador correcto, diferencia distinta' },
  { outcomeType: 'MISS', basePoints: 0, description: 'No se acertó el resultado' },
];

const PHASE_MULTIPLIERS: Array<{
  phase:
    | 'GROUPS'
    | 'ROUND_32'
    | 'ROUND_16'
    | 'QUARTERS'
    | 'SEMIS'
    | 'THIRD_PLACE'
    | 'FINAL';
  multiplier: number;
}> = [
  { phase: 'GROUPS', multiplier: 1.0 },
  { phase: 'ROUND_32', multiplier: 1.5 },
  { phase: 'ROUND_16', multiplier: 2.0 },
  { phase: 'QUARTERS', multiplier: 3.0 },
  { phase: 'SEMIS', multiplier: 4.0 },
  { phase: 'THIRD_PLACE', multiplier: 4.0 },
  { phase: 'FINAL', multiplier: 5.0 },
];

const SPECIAL_PRIZE_RULES = [
  { key: 'champion', points: 25, description: 'Acertar el campeón del Mundial' },
  { key: 'runnerUp', points: 12, description: 'Acertar el subcampeón' },
  { key: 'thirdPlace', points: 8, description: 'Acertar el tercer puesto' },
  { key: 'topScorer', points: 15, description: 'Acertar el goleador del torneo' },
  { key: 'totalGoalsExact', points: 10, description: 'Acertar el total de goles del torneo (exacto)' },
  { key: 'totalGoalsClose', points: 5, description: 'Acertar el total de goles del torneo con margen ±5' },
];

const APP_CONFIG = [
  { key: 'inscripcion_precio', value: '10000', description: 'Precio de inscripción en ARS' },
  { key: 'inscripcion_cierre', value: '2026-06-11T19:00:00-03:00', description: 'Fecha límite para inscribirse (ISO 8601)' },
  { key: 'pozo_dist_top1', value: '0.25', description: 'Porcentaje del pozo para el primer puesto' },
  { key: 'pozo_dist_top2', value: '0.12', description: 'Porcentaje del pozo para el segundo puesto' },
  { key: 'pozo_dist_top3', value: '0.08', description: 'Porcentaje del pozo para el tercer puesto' },
  { key: 'pozo_dist_fase', value: '0.05', description: 'Porcentaje del pozo para el ganador de cada fase' },
  { key: 'pozo_club', value: '0.20', description: 'Porcentaje del pozo retenido por el club' },
  { key: 'pozo_reserva', value: '0.05', description: 'Porcentaje del pozo retenido como reserva / fondo de premios especiales' },
  { key: 'max_entries_per_user', value: '5', description: 'Máximo de entradas (prodes) por usuario' },
  { key: 'max_users', value: '500', description: 'Máximo total de usuarios (role=USER) en el sistema' },
];

// ─── Demo seed constants (copied from seed-demo.ts) ──────────────────────

const DEMO_PASSWORD = 'demo123!';

const DEMO_BOTS = [
  { firstName: 'Lionel', lastName: 'Bot', dni: '90000001', whatsapp: '5491190000001' },
  { firstName: 'Diego', lastName: 'Bot', dni: '90000002', whatsapp: '5491190000002' },
  { firstName: 'Mario', lastName: 'Bot', dni: '90000003', whatsapp: '5491190000003' },
  { firstName: 'Daniel', lastName: 'Bot', dni: '90000004', whatsapp: '5491190000004' },
];

const PERSONAL_USER = {
  firstName: 'Demo',
  lastName: 'Personal',
  dni: '90000099',
  whatsapp: '5491199999999',
};

const DEMO_DURATION_DAYS = 7;
const TOTAL_MATCHES = 104;

function randomScore(): number {
  const buckets = [0, 0, 0, 1, 1, 1, 1, 2, 2, 3];
  return buckets[Math.floor(Math.random() * buckets.length)]!;
}

function kickoffForMatchNumber(matchNumber: number, anchor: Date): Date {
  const startMs = anchor.getTime() + 60 * 60 * 1000; // now + 1h
  const endMs = anchor.getTime() + DEMO_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const span = endMs - startMs;
  const ratio = (matchNumber - 1) / (TOTAL_MATCHES - 1);
  return new Date(startMs + span * ratio);
}

@Controller('admin/dev/seed')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AdminDevSeedController {
  constructor(private readonly prisma: PrismaService) {}

  // ── 1) Teams ───────────────────────────────────────────────────────────

  @Post('teams')
  async seedTeams(): Promise<{ count: number; inserted: number; updated: number }> {
    const raw = await readFile(join(PRISMA_DATA_DIR, 'teams.json'), 'utf8');
    const teams = JSON.parse(raw) as SeedTeam[];

    let inserted = 0;
    let updated = 0;

    for (const t of teams) {
      const existing = await this.prisma.team.findUnique({
        where: { fifaCode: t.fifaCode },
      });
      await this.prisma.team.upsert({
        where: { fifaCode: t.fifaCode },
        update: {
          name: t.name,
          shortName: t.shortName,
          flagUrl: t.flagUrl,
          confederation: t.confederation,
          groupCode: t.groupCode,
          fifaRanking: t.fifaRanking,
        },
        create: t,
      });
      if (existing) updated++;
      else inserted++;
    }

    return { count: teams.length, inserted, updated };
  }

  // ── 2) Config (scoring rules / multipliers / prizes / app_config) ──────
  //
  // NOTE: el seedAdminUser de seed-config.ts NO se replica aquí: el admin ya
  // existe (es quien llama a este endpoint con su JWT) y no queremos
  // sobrescribir su password ni crear otro registro accidentalmente.

  @Post('config')
  async seedConfig(): Promise<{
    scoringRules: number;
    phaseMultipliers: number;
    specialPrizeRules: number;
    appConfig: number;
  }> {
    for (const r of SCORING_RULES) {
      await this.prisma.scoringRule.upsert({
        where: { outcomeType: r.outcomeType },
        update: { basePoints: r.basePoints, description: r.description },
        create: r,
      });
    }
    for (const m of PHASE_MULTIPLIERS) {
      await this.prisma.phaseMultiplier.upsert({
        where: { phase: m.phase },
        update: { multiplier: m.multiplier },
        create: m,
      });
    }
    for (const s of SPECIAL_PRIZE_RULES) {
      await this.prisma.specialPrizeRule.upsert({
        where: { key: s.key },
        update: { points: s.points, description: s.description },
        create: s,
      });
    }
    for (const c of APP_CONFIG) {
      await this.prisma.appConfig.upsert({
        where: { key: c.key },
        update: { value: c.value, description: c.description },
        create: c,
      });
    }

    return {
      scoringRules: SCORING_RULES.length,
      phaseMultipliers: PHASE_MULTIPLIERS.length,
      specialPrizeRules: SPECIAL_PRIZE_RULES.length,
      appConfig: APP_CONFIG.length,
    };
  }

  // ── 3) Matches ─────────────────────────────────────────────────────────

  @Post('matches')
  async seedMatches(): Promise<{ count: number; inserted: number; updated: number }> {
    const teams = await this.prisma.team.findMany({
      select: { id: true, fifaCode: true },
    });
    if (teams.length === 0) {
      throw new BadRequestException(
        'Run /admin/dev/seed/teams first',
      );
    }

    const raw = await readFile(join(PRISMA_DATA_DIR, 'matches.json'), 'utf8');
    const matches = JSON.parse(raw) as SeedMatch[];

    const fifaToId = new Map(teams.map((t) => [t.fifaCode, t.id]));
    const isFifaCode = (s: string) => /^[A-Z]{3}$/.test(s);

    let inserted = 0;
    let updated = 0;

    for (const m of matches) {
      const existing = await this.prisma.match.findUnique({
        where: { matchNumber: m.matchNumber },
      });
      const homeTeamId = isFifaCode(m.homeTeamLabel)
        ? fifaToId.get(m.homeTeamLabel) ?? null
        : null;
      const awayTeamId = isFifaCode(m.awayTeamLabel)
        ? fifaToId.get(m.awayTeamLabel) ?? null
        : null;
      const data = {
        phase: m.phase,
        groupCode: m.groupCode,
        homeTeamId,
        awayTeamId,
        homeTeamLabel: m.homeTeamLabel,
        awayTeamLabel: m.awayTeamLabel,
        kickoffAt: new Date(m.kickoffAt),
        predictionsLockAt: new Date(m.predictionsLockAt),
        venue: m.venue,
        city: m.city,
        country: m.country,
      };
      await this.prisma.match.upsert({
        where: { matchNumber: m.matchNumber },
        update: data,
        create: { matchNumber: m.matchNumber, ...data },
      });
      if (existing) updated++;
      else inserted++;
    }

    return { count: matches.length, inserted, updated };
  }

  // ── 4) Demo (timeline compression + 4 bots + 1 personal user) ──────────

  @Post('demo')
  async seedDemo(): Promise<{
    compressedMatches: number;
    users: Array<{
      dni: string;
      firstName: string;
      predictions: number;
      personal?: boolean;
    }>;
    credentials: string;
  }> {
    // Precondition: matches must exist (otherwise compress is a no-op and
    // bots end up with 0 predictions silently).
    const matchCount = await this.prisma.match.count();
    if (matchCount === 0) {
      throw new BadRequestException(
        'Run /admin/dev/seed/teams + /admin/dev/seed/matches first',
      );
    }

    const anchor = new Date();

    // 1) Compress kickoff timeline (matchNumber 1 → anchor+1h, 104 → anchor+7d).
    const matches = await this.prisma.match.findMany({
      select: { id: true, matchNumber: true },
      orderBy: { matchNumber: 'asc' },
    });
    for (const m of matches) {
      const kickoffAt = kickoffForMatchNumber(m.matchNumber, anchor);
      const predictionsLockAt = new Date(kickoffAt.getTime() - 60 * 60 * 1000);
      await this.prisma.match.update({
        where: { id: m.id },
        data: { kickoffAt, predictionsLockAt },
      });
    }

    // 2) (Re)create demo users.
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const out: Array<{
      dni: string;
      firstName: string;
      predictions: number;
      personal?: boolean;
    }> = [];

    for (const bot of DEMO_BOTS) {
      const entry = await this.recreateDemoUser(bot, passwordHash);
      const predictions = await this.createBotPredictions(entry.id);
      out.push({ dni: bot.dni, firstName: bot.firstName, predictions });
    }

    await this.recreateDemoUser(PERSONAL_USER, passwordHash);
    out.push({
      dni: PERSONAL_USER.dni,
      firstName: PERSONAL_USER.firstName,
      predictions: 0,
      personal: true,
    });

    return {
      compressedMatches: matches.length,
      users: out,
      credentials: 'All users password=demo123!',
    };
  }

  // ── Helpers (demo) ─────────────────────────────────────────────────────

  private async recreateDemoUser(
    spec: { firstName: string; lastName: string; dni: string; whatsapp: string },
    passwordHash: string,
  ): Promise<{ id: string }> {
    // Wrap delete + create in a single transaction so we don't leave a
    // half-deleted user if something goes wrong mid-recreation.
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { dni: spec.dni } });
      if (existing) {
        await tx.prediction.deleteMany({
          where: { entry: { userId: existing.id } },
        });
        await tx.specialPrediction.deleteMany({
          where: { entry: { userId: existing.id } },
        });
        await tx.leagueMembership.deleteMany({
          where: { entry: { userId: existing.id } },
        });
        await tx.entry.deleteMany({ where: { userId: existing.id } });
        await tx.payment.deleteMany({ where: { userId: existing.id } });
        await tx.user.delete({ where: { id: existing.id } });
      }

      const user = await tx.user.create({
        data: {
          dni: spec.dni,
          firstName: spec.firstName,
          lastName: spec.lastName,
          whatsapp: spec.whatsapp,
          passwordHash,
          role: 'USER',
          status: 'ACTIVE',
          whatsappOptIn: false,
        },
      });

      const now = new Date();
      const payment = await tx.payment.create({
        data: {
          userId: user.id,
          amount: 10000,
          method: 'CASH',
          status: 'APPROVED',
          paidAt: now,
          completedAt: now,
          notes: 'Seed demo: APPROVED por admin-dev-seed.controller',
        },
      });

      const entry = await tx.entry.create({
        data: {
          userId: user.id,
          paymentId: payment.id,
          position: 1,
          status: 'ACTIVE',
        },
      });

      return { id: entry.id };
    });
  }

  private async createBotPredictions(entryId: string): Promise<number> {
    const now = new Date();
    const matches = await this.prisma.match.findMany({
      where: {
        phase: 'GROUPS',
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        predictionsLockAt: { gt: now },
      },
      select: { id: true },
    });

    for (const m of matches) {
      await this.prisma.prediction.create({
        data: {
          entryId,
          matchId: m.id,
          scoreHome: randomScore(),
          scoreAway: randomScore(),
        },
      });
    }

    return matches.length;
  }
}
