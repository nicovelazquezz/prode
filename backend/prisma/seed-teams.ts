// Seeds the 48 selecciones del Mundial 2026.
// TODO: validar lista oficial FIFA pre-launch (algunos cupos están sujetos a
// repechajes intercontinentales que se juegan en marzo 2026).
//
// Run:  npx tsx prisma/seed-teams.ts

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import teams from './data/teams.json' with { type: 'json' };

type SeedTeam = {
  fifaCode: string;
  name: string;
  shortName: string;
  flagUrl: string;
  confederation:
    | 'CONMEBOL'
    | 'UEFA'
    | 'CONCACAF'
    | 'AFC'
    | 'CAF'
    | 'OFC';
  groupCode: string | null;
  fifaRanking: number | null;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  let inserted = 0;
  let updated = 0;

  for (const t of teams as SeedTeam[]) {
    const existing = await prisma.team.findUnique({ where: { fifaCode: t.fifaCode } });
    await prisma.team.upsert({
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

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${teams.length} teams (${inserted} inserted, ${updated} updated)`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
