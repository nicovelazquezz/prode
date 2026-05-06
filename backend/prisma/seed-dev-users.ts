// Seeds 5 development "regular" users used by the Playwright E2E suite,
// plus one APPROVED Payment + Entry (position=1) per user so the app is
// usable inmediatamente sin tener que correr el flujo de checkout.
//
// DNIs:    11111111, 22222222, 33333333, 44444444, 55555555
// Password: prode2026 (bcrypt cost=12 hash persisted)
//
// Run:  NODE_ENV=development npx tsx prisma/seed-dev-users.ts
//
// Idempotent:
//   - User: upserted por DNI. El passwordHash queda untouched salvo que
//     SEED_DEV_RESET_PASSWORD=1, en cuyo caso se reescribe.
//   - Entry: si el user ya tiene >=1 entry, no se toca nada. Si no tiene,
//     se crea un Payment CASH/APPROVED + un Entry position=1 en la
//     misma transacción.
//
// Hard-guard: refuses to run when NODE_ENV === 'production'. These DNIs
// (all-1s, all-2s, ...) are not a valid Argentine DNI shape so they
// cannot collide with real users, but we still draw a line in the sand.

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PASSWORD = 'prode2026';
const RESET = process.env.SEED_DEV_RESET_PASSWORD === '1';

const USERS = [
  { dni: '11111111', firstName: 'Test', lastName: 'Uno', whatsapp: '5492914000011' },
  { dni: '22222222', firstName: 'Test', lastName: 'Dos', whatsapp: '5492914000022' },
  { dni: '33333333', firstName: 'Test', lastName: 'Tres', whatsapp: '5492914000033' },
  { dni: '44444444', firstName: 'Test', lastName: 'Cuatro', whatsapp: '5492914000044' },
  { dni: '55555555', firstName: 'Test', lastName: 'Cinco', whatsapp: '5492914000055' },
];

async function ensureUser(u: (typeof USERS)[number], passwordHash: string) {
  const existing = await prisma.user.findUnique({ where: { dni: u.dni } });
  if (existing) {
    if (RESET) {
      const updated = await prisma.user.update({
        where: { dni: u.dni },
        data: { passwordHash, status: 'ACTIVE', role: 'USER' },
      });
      // eslint-disable-next-line no-console
      console.log(`Reset password for dev user dni=${u.dni}`);
      return updated;
    }
    // eslint-disable-next-line no-console
    console.log(`Dev user dni=${u.dni} already exists — leaving untouched.`);
    return existing;
  }

  const created = await prisma.user.create({
    data: { ...u, passwordHash, role: 'USER', status: 'ACTIVE' },
  });
  // eslint-disable-next-line no-console
  console.log(`Created dev user dni=${u.dni}`);
  return created;
}

async function ensureFirstEntry(userId: string, dni: string) {
  const existing = await prisma.entry.findFirst({ where: { userId } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`Dev user dni=${dni} already has entries — skipping.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        userId,
        amount: 10000,
        method: 'CASH',
        status: 'APPROVED',
        notes: 'Seed dev: APPROVED por seed-dev-users.ts',
      },
    });
    await tx.entry.create({
      data: {
        userId,
        paymentId: payment.id,
        status: 'ACTIVE',
        position: 1,
      },
    });
  });
  // eslint-disable-next-line no-console
  console.log(`Created Payment+Entry (position=1) for dev user dni=${dni}`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('Refusing to seed dev users when NODE_ENV=production');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  for (const u of USERS) {
    const user = await ensureUser(u, passwordHash);
    await ensureFirstEntry(user.id, u.dni);
  }

  // eslint-disable-next-line no-console
  console.log(`Done. (password = "${PASSWORD}", set SEED_DEV_RESET_PASSWORD=1 to overwrite)`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
