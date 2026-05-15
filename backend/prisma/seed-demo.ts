// Seeds a playable demo state on top of seed-teams + seed-config + seed-matches.
//
// Creates:
//   - 4 bot users with predictions pre-cast on every GROUPS match still open.
//   - 1 personal user (the human player) without predictions.
//   - Compresses all 104 kickoff times into a 7-day window starting now,
//     linearly spaced by matchNumber. predictionsLockAt = kickoffAt - 1h.
//
// Idempotent: re-running deletes-and-recreates the 5 demo users (DNIs 90000001
// — 90000004 + 90000099) and re-stretches the kickoff timeline from `now`.
//
// Run:  NODE_ENV=development npx tsx prisma/seed-demo.ts
//
// Order of seeds:
//   seed-teams.ts   → seed-config.ts   → seed-matches.ts   → seed-demo.ts

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Constants ────────────────────────────────────────────────────────────

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

// 7-day demo window starting now.
const DEMO_DURATION_DAYS = 7;
const TOTAL_MATCHES = 104;

type DemoUserSpec = {
  firstName: string;
  lastName: string;
  dni: string;
  whatsapp: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function randomScore(): number {
  // Weighted toward 0-2 goals like real football.
  const buckets = [0, 0, 0, 1, 1, 1, 1, 2, 2, 3];
  return buckets[Math.floor(Math.random() * buckets.length)]!;
}

/**
 * Linearly distribute matchNumber in [1, TOTAL_MATCHES] over the 7-day window
 * starting `now + 1h` and ending `now + 7d`. Returns the kickoff Date.
 */
function kickoffForMatchNumber(matchNumber: number, anchor: Date): Date {
  const startMs = anchor.getTime() + 60 * 60 * 1000; // now + 1h
  const endMs = anchor.getTime() + DEMO_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const span = endMs - startMs;
  const ratio = (matchNumber - 1) / (TOTAL_MATCHES - 1);
  return new Date(startMs + span * ratio);
}

async function compressKickoffTimeline(anchor: Date) {
  const matches = await prisma.match.findMany({
    select: { id: true, matchNumber: true },
    orderBy: { matchNumber: 'asc' },
  });

  for (const m of matches) {
    const kickoffAt = kickoffForMatchNumber(m.matchNumber, anchor);
    const predictionsLockAt = new Date(kickoffAt.getTime() - 60 * 60 * 1000);
    await prisma.match.update({
      where: { id: m.id },
      data: { kickoffAt, predictionsLockAt },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Compressed ${matches.length} matches into ${DEMO_DURATION_DAYS} days from ${anchor.toISOString()}.`,
  );
}

async function deleteDemoUserIfExists(dni: string) {
  const existing = await prisma.user.findUnique({ where: { dni } });
  if (!existing) return;

  await prisma.$transaction(async (tx) => {
    // Predictions cascade from Entry, but we delete them explicitly first to
    // keep the order obvious and to be defensive across schema changes.
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
  });
}

async function createDemoUser(spec: DemoUserSpec, passwordHash: string) {
  await deleteDemoUserIfExists(spec.dni);

  const user = await prisma.user.create({
    data: {
      dni: spec.dni,
      firstName: spec.firstName,
      lastName: spec.lastName,
      whatsapp: spec.whatsapp,
      passwordHash,
      role: 'USER',
      status: 'ACTIVE',
      whatsappOptIn: false, // demo: don't send WA notifs
    },
  });

  const now = new Date();
  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      amount: 10000,
      method: 'CASH',
      status: 'APPROVED',
      paidAt: now,
      completedAt: now,
      notes: 'Seed demo: APPROVED por seed-demo.ts',
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

  return { user, entry };
}

async function createBotPredictions(entryId: string) {
  const now = new Date();
  const matches = await prisma.match.findMany({
    where: {
      phase: 'GROUPS',
      homeTeamId: { not: null },
      awayTeamId: { not: null },
      predictionsLockAt: { gt: now },
    },
    select: { id: true },
  });

  for (const m of matches) {
    await prisma.prediction.create({
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

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('Refusing to run seed-demo.ts when NODE_ENV=production');
    process.exit(1);
  }

  const anchor = new Date();

  // 1) Compress the kickoff timeline so the demo plays out in ~7 days.
  await compressKickoffTimeline(anchor);

  // 2) (Re)create the 5 demo users with fresh Payment + Entry.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const bot of DEMO_BOTS) {
    const { entry } = await createDemoUser(bot, passwordHash);
    const count = await createBotPredictions(entry.id);
    // eslint-disable-next-line no-console
    console.log(`Bot dni=${bot.dni} created with ${count} GROUPS predictions.`);
  }

  await createDemoUser(PERSONAL_USER, passwordHash);
  // eslint-disable-next-line no-console
  console.log(`Personal user dni=${PERSONAL_USER.dni} created (no predictions).`);

  // 3) Print credentials.
  // eslint-disable-next-line no-console
  console.log('\n✓ Seed demo complete.\n');
  // eslint-disable-next-line no-console
  console.log('Credenciales (todos password = demo123!):\n');
  // eslint-disable-next-line no-console
  console.log('PERSONAL (vos):');
  // eslint-disable-next-line no-console
  console.log(`  DNI: ${PERSONAL_USER.dni}`);
  // eslint-disable-next-line no-console
  console.log(`  WhatsApp: ${PERSONAL_USER.whatsapp}`);
  // eslint-disable-next-line no-console
  console.log('\nBOTS (con predicciones cargadas):');
  for (const b of DEMO_BOTS) {
    // eslint-disable-next-line no-console
    console.log(`  ${b.firstName} ${b.lastName} — DNI: ${b.dni}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nTimeline comprimido: ${DEMO_DURATION_DAYS} días desde ahora.`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed demo failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
