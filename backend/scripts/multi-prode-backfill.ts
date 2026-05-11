// Multi-prode backfill: idempotent script that populates the new entries
// table + entryId columns from existing user-scoped data.
//
// Steps (single TX):
//   1. INSERT one Entry per user with at least one APPROVED Payment
//      (using the OLDEST APPROVED Payment for that user as paymentId).
//   2. UPDATE predictions.entryId from entries.userId
//   3. UPDATE special_predictions.entryId
//   4. UPDATE phase_winners.entryId
//   5. UPDATE league_memberships.entryId
//
// Idempotent via NOT EXISTS clauses on the INSERT and entryId IS NULL
// guards on the UPDATEs. Re-running is a no-op once the data is settled.
//
// Run:  npx tsx scripts/multi-prode-backfill.ts

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // eslint-disable-next-line no-console
  console.log('=== Multi-prode Backfill ===');

  await prisma.$transaction(async (tx) => {
    // 1. Create Entry #1 per user with APPROVED Payment, picking the OLDEST
    //    APPROVED payment (deterministic). Skip users that already have an
    //    entry (idempotent re-run).
    const insertedEntriesResult = await tx.$executeRaw`
      INSERT INTO entries (id, "userId", "paymentId", "position", "status", "createdAt", "updatedAt")
      SELECT
        'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24) AS id,
        p."userId",
        p.id,
        1,
        'ACTIVE',
        NOW(),
        NOW()
      FROM payments p
      WHERE p.status = 'APPROVED'
        AND p."userId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM entries e WHERE e."userId" = p."userId"
        )
        AND p.id = (
          SELECT id FROM payments p2
          WHERE p2."userId" = p."userId" AND p2.status = 'APPROVED'
          ORDER BY p2."createdAt" ASC
          LIMIT 1
        )
    `;
    // eslint-disable-next-line no-console
    console.log(`1. Entries created: ${insertedEntriesResult}`);

    // 2. Backfill predictions.entryId from entries.userId.
    const predictionsUpdated = await tx.$executeRaw`
      UPDATE predictions p
      SET "entryId" = (
        SELECT e.id FROM entries e WHERE e."userId" = p."userId" LIMIT 1
      )
      WHERE p."entryId" IS NULL
        AND EXISTS (SELECT 1 FROM entries e WHERE e."userId" = p."userId")
    `;
    // eslint-disable-next-line no-console
    console.log(`2. predictions.entryId updated: ${predictionsUpdated}`);

    // 3. Backfill special_predictions.entryId.
    const specialUpdated = await tx.$executeRaw`
      UPDATE special_predictions sp
      SET "entryId" = (
        SELECT e.id FROM entries e WHERE e."userId" = sp."userId" LIMIT 1
      )
      WHERE sp."entryId" IS NULL
        AND EXISTS (SELECT 1 FROM entries e WHERE e."userId" = sp."userId")
    `;
    // eslint-disable-next-line no-console
    console.log(`3. special_predictions.entryId updated: ${specialUpdated}`);

    // 4. Backfill phase_winners.entryId.
    const phaseWinnersUpdated = await tx.$executeRaw`
      UPDATE phase_winners pw
      SET "entryId" = (
        SELECT e.id FROM entries e WHERE e."userId" = pw."userId" LIMIT 1
      )
      WHERE pw."entryId" IS NULL
        AND EXISTS (SELECT 1 FROM entries e WHERE e."userId" = pw."userId")
    `;
    // eslint-disable-next-line no-console
    console.log(`4. phase_winners.entryId updated: ${phaseWinnersUpdated}`);

    // 5. Backfill league_memberships.entryId.
    const membershipsUpdated = await tx.$executeRaw`
      UPDATE league_memberships lm
      SET "entryId" = (
        SELECT e.id FROM entries e WHERE e."userId" = lm."userId" LIMIT 1
      )
      WHERE lm."entryId" IS NULL
        AND EXISTS (SELECT 1 FROM entries e WHERE e."userId" = lm."userId")
    `;
    // eslint-disable-next-line no-console
    console.log(`5. league_memberships.entryId updated: ${membershipsUpdated}`);
  });

  // Post-backfill report (outside TX): rows still NULL are orphans that
  // multi-prode-delete-orphans.sql will purge after backup.
  const orphans = await prisma.$queryRaw<{ kind: string; count: bigint }[]>`
    SELECT 'predictions'::text AS kind,
      (SELECT COUNT(*) FROM predictions WHERE "entryId" IS NULL)::bigint AS count
    UNION ALL
    SELECT 'special_predictions',
      (SELECT COUNT(*) FROM special_predictions WHERE "entryId" IS NULL)::bigint
    UNION ALL
    SELECT 'phase_winners',
      (SELECT COUNT(*) FROM phase_winners WHERE "entryId" IS NULL)::bigint
    UNION ALL
    SELECT 'league_memberships',
      (SELECT COUNT(*) FROM league_memberships WHERE "entryId" IS NULL)::bigint
  `;

  // eslint-disable-next-line no-console
  console.log('\nResidual NULL counts (orphans, will be purged after backup):');
  orphans.forEach((o) => {
    // eslint-disable-next-line no-console
    console.log(`  - ${o.kind}: ${Number(o.count)}`);
  });

  // eslint-disable-next-line no-console
  console.log('\nBackfill completed.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
