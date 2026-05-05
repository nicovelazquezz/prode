// Seeds 5 development "regular" users used by the Playwright E2E suite.
//
// DNIs:    11111111, 22222222, 33333333, 44444444, 55555555
// Password: prode2026 (bcrypt cost=12 hash persisted)
//
// Run:  NODE_ENV=development npx tsx prisma/seed-dev-users.ts
//
// Idempotent: every user is upserted by DNI. Pre-existing users keep
// their current passwordHash untouched UNLESS env var
// SEED_DEV_RESET_PASSWORD=1 is set, in which case the hash is rewritten
// (useful when the test suite assumes the canonical password).
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

async function main() {
  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('Refusing to seed dev users when NODE_ENV=production');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { dni: u.dni } });
    if (existing) {
      if (RESET) {
        await prisma.user.update({
          where: { dni: u.dni },
          data: { passwordHash, status: 'ACTIVE', role: 'USER' },
        });
        // eslint-disable-next-line no-console
        console.log(`Reset password for dev user dni=${u.dni}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`Dev user dni=${u.dni} already exists — leaving untouched.`);
      }
      continue;
    }

    await prisma.user.create({
      data: {
        ...u,
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Created dev user dni=${u.dni}`);
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
