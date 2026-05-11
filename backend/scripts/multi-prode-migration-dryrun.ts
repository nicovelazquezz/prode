// Multi-prode migration dry-run: reports BD health pre-migration WITHOUT
// modifying anything. Intended to be run before `multi-prode-backfill.ts`.
//
// Reports:
//   - Total Users
//   - Users with Payment APPROVED (will become Entry #1 each)
//   - Users with multiple APPROVED Payments (alert: only oldest is used)
//   - Orphans: rows in predictions/special_predictions/phase_winners/league_memberships
//     whose userId has NO Payment APPROVED (will be DELETED in M2)
//
// Exits non-zero (1) if any orphan count exceeds ABORT_THRESHOLD.
//
// Run:  npx tsx scripts/multi-prode-migration-dryrun.ts [--json]

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const ABORT_THRESHOLD = Number(process.env.MULTI_PRODE_ABORT_THRESHOLD ?? 5);
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const asJson = process.argv.includes('--json');

interface Totals {
  users: bigint;
  usersWithPayment: bigint;
}

interface OrphanRow {
  kind: string;
  count: bigint;
}

interface MultiPayRow {
  userId: string;
  payments: bigint;
}

async function main() {
  const totalsRows = await prisma.$queryRaw<Totals[]>`
    SELECT
      (SELECT COUNT(*) FROM users)::bigint AS users,
      (SELECT COUNT(DISTINCT u.id) FROM users u
        WHERE EXISTS (
          SELECT 1 FROM payments p
          WHERE p."userId" = u.id AND p.status = 'APPROVED'
        ))::bigint AS "usersWithPayment"
  `;
  const totals = totalsRows[0];

  const orphans = await prisma.$queryRaw<OrphanRow[]>`
    SELECT 'predictions'::text AS kind,
      (SELECT COUNT(*) FROM predictions p WHERE NOT EXISTS (
         SELECT 1 FROM payments pay WHERE pay."userId" = p."userId" AND pay.status = 'APPROVED'
      ))::bigint AS count
    UNION ALL
    SELECT 'special_predictions',
      (SELECT COUNT(*) FROM special_predictions sp WHERE NOT EXISTS (
         SELECT 1 FROM payments pay WHERE pay."userId" = sp."userId" AND pay.status = 'APPROVED'
      ))::bigint
    UNION ALL
    SELECT 'phase_winners',
      (SELECT COUNT(*) FROM phase_winners pw WHERE NOT EXISTS (
         SELECT 1 FROM payments pay WHERE pay."userId" = pw."userId" AND pay.status = 'APPROVED'
      ))::bigint
    UNION ALL
    SELECT 'league_memberships',
      (SELECT COUNT(*) FROM league_memberships lm WHERE NOT EXISTS (
         SELECT 1 FROM payments pay WHERE pay."userId" = lm."userId" AND pay.status = 'APPROVED'
      ))::bigint
  `;

  const multiPay = await prisma.$queryRaw<MultiPayRow[]>`
    SELECT "userId", COUNT(*)::bigint AS payments
    FROM payments
    WHERE status = 'APPROVED' AND "userId" IS NOT NULL
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  `;

  const abort = orphans.some((o) => Number(o.count) > ABORT_THRESHOLD);

  if (asJson) {
    const payload = {
      totals: {
        users: Number(totals.users),
        usersWithPayment: Number(totals.usersWithPayment),
      },
      multiPay: multiPay.map((m) => ({
        userId: m.userId,
        payments: Number(m.payments),
      })),
      orphans: orphans.map((o) => ({
        kind: o.kind,
        count: Number(o.count),
      })),
      abortThreshold: ABORT_THRESHOLD,
      abort,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log('=== Multi-prode Migration Dry-Run ===');
    // eslint-disable-next-line no-console
    console.log(`Total users: ${totals.users}`);
    // eslint-disable-next-line no-console
    console.log(`Users con Payment APPROVED (futuro Entry #1): ${totals.usersWithPayment}`);
    // eslint-disable-next-line no-console
    console.log('\nUsers con múltiples Payments APPROVED (solo el más antiguo se usa):');
    if (multiPay.length === 0) {
      // eslint-disable-next-line no-console
      console.log('  (ninguno)');
    } else {
      multiPay.forEach((u) => {
        // eslint-disable-next-line no-console
        console.log(`  - userId=${u.userId} payments=${u.payments}`);
      });
    }
    // eslint-disable-next-line no-console
    console.log('\nFilas huérfanas (sin Payment APPROVED del user, serán DELETED):');
    orphans.forEach((o) => {
      const n = Number(o.count);
      const flag = n > ABORT_THRESHOLD ? ' [ABORT]' : '';
      // eslint-disable-next-line no-console
      console.log(`  - ${o.kind}: ${n}${flag}`);
    });
    // eslint-disable-next-line no-console
    console.log(`\nAbort threshold: ${ABORT_THRESHOLD}`);
  }

  if (abort) {
    // eslint-disable-next-line no-console
    console.error(
      `\nABORT: huérfanas > threshold ${ABORT_THRESHOLD}. Investigar antes de continuar.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!asJson) {
    // eslint-disable-next-line no-console
    console.log('\nOK para proceder con M1 + backfill.');
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
