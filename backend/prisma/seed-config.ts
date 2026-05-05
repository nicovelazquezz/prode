// Seeds default ScoringRule, PhaseMultiplier, SpecialPrizeRule, AppConfig
// rows and bootstraps the admin user (DNI + bcrypt-hashed password from env).
//
// Run:  npx tsx prisma/seed-config.ts
//
// Idempotency: every row is upserted by its natural unique key. The admin
// user is upserted by DNI; if the user already exists the password is left
// untouched (so re-running this script is safe in production).

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Defaults from spec section 5.2 / plan task 2.6 ──────────────────────

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
];

async function seedScoringRules() {
  for (const r of SCORING_RULES) {
    await prisma.scoringRule.upsert({
      where: { outcomeType: r.outcomeType },
      update: { basePoints: r.basePoints, description: r.description },
      create: r,
    });
  }
}

async function seedPhaseMultipliers() {
  for (const m of PHASE_MULTIPLIERS) {
    await prisma.phaseMultiplier.upsert({
      where: { phase: m.phase },
      update: { multiplier: m.multiplier },
      create: m,
    });
  }
}

async function seedSpecialPrizeRules() {
  for (const s of SPECIAL_PRIZE_RULES) {
    await prisma.specialPrizeRule.upsert({
      where: { key: s.key },
      update: { points: s.points, description: s.description },
      create: s,
    });
  }
}

async function seedAppConfig() {
  for (const c of APP_CONFIG) {
    await prisma.appConfig.upsert({
      where: { key: c.key },
      update: { value: c.value, description: c.description },
      create: c,
    });
  }
}

async function seedAdminUser() {
  const dni = process.env.ADMIN_DEFAULT_DNI;
  const password = process.env.ADMIN_DEFAULT_PASSWORD;
  if (!dni || !password) {
    // eslint-disable-next-line no-console
    console.warn(
      'ADMIN_DEFAULT_DNI / ADMIN_DEFAULT_PASSWORD not set — skipping admin user.',
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { dni } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`Admin user (dni=${dni}) already exists — leaving password untouched.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      dni,
      firstName: 'Admin',
      lastName: 'Tiro Federal',
      whatsapp: '5492914000000',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  // eslint-disable-next-line no-console
  console.log(`Created admin user (dni=${dni}).`);
}

async function main() {
  await seedScoringRules();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${SCORING_RULES.length} scoring rules`);

  await seedPhaseMultipliers();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${PHASE_MULTIPLIERS.length} phase multipliers`);

  await seedSpecialPrizeRules();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${SPECIAL_PRIZE_RULES.length} special prize rules`);

  await seedAppConfig();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${APP_CONFIG.length} app config entries`);

  await seedAdminUser();
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
