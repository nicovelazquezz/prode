// Seeds los jugadores del Mundial 2026.
// players.json es generado por backend/scripts/scraper/scrape.py --target players
//
// Cada item: { fullName, teamFifaCode, shirtNumber }. Resuelve teamFifaCode →
// teamId vía Team.fifaCode. Upsert por (teamId, fullName, shirtNumber): si hay
// dos jugadores con mismo nombre, los distingue el número de camiseta.
//
// Run:  npx tsx prisma/seed-players.ts

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import players from './data/players.json' with { type: 'json' };

type SeedPlayer = {
  fullName: string;
  teamFifaCode: string;
  shirtNumber: number | null;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const teams = await prisma.team.findMany({ select: { id: true, fifaCode: true } });
  const fifaToId = new Map(teams.map((t) => [t.fifaCode, t.id]));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const p of players as SeedPlayer[]) {
    const teamId = fifaToId.get(p.teamFifaCode);
    if (!teamId) {
      // eslint-disable-next-line no-console
      console.warn(`Skip ${p.fullName}: team ${p.teamFifaCode} no seedeado`);
      skipped++;
      continue;
    }

    const existing = await prisma.player.findFirst({
      where: { fullName: p.fullName, teamId, shirtNumber: p.shirtNumber },
      select: { id: true },
    });

    if (existing) {
      await prisma.player.update({
        where: { id: existing.id },
        data: { shirtNumber: p.shirtNumber },
      });
      updated++;
    } else {
      await prisma.player.create({
        data: { fullName: p.fullName, teamId, shirtNumber: p.shirtNumber },
      });
      inserted++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${players.length} players (${inserted} inserted, ${updated} updated, ${skipped} skipped)`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
