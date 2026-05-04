import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MatchRemindersCron } from './match-reminders.cron.js';

/**
 * Integration test for `MatchRemindersCron.sendReminders`. Strategy:
 *
 *   1. Snap an existing seed match into the 2h window (kickoff in ~1h).
 *   2. Create one user that has NO prediction (should get reminded) and
 *      a control user that DID predict (should NOT get reminded).
 *   3. Call the cron method directly (the scheduler would only fire
 *      every 15 min, which is too slow for a unit-test budget).
 *   4. Assert the Notification rows landed for the eligible user only,
 *      and that re-running the cron is a no-op (dedupKey absorbs it).
 *
 * Cleanup restores the match's original kickoff/lock fields so neighbour
 * suites that also lean on seed matches stay happy.
 */
describe('MatchRemindersCron.sendReminders (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cron: MatchRemindersCron;

  const stamp = Date.now();
  const eligibleDni = `33${String(stamp).slice(-7)}`;
  const predictedDni = `34${String(stamp).slice(-7)}`;
  const optedOutDni = `35${String(stamp).slice(-7)}`;

  let eligibleUserId: string;
  let predictedUserId: string;
  let optedOutUserId: string;
  let targetMatchId: string;

  type MatchSnapshot = {
    id: string;
    status: string;
    kickoffAt: Date;
    predictionsLockAt: Date;
  };
  let matchSnapshot: MatchSnapshot | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    cron = app.get(MatchRemindersCron);

    // Pick a higher-numbered seed match so we don't collide with the
    // matches.cron suite (which uses #90).
    const target = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 91 },
    });
    targetMatchId = target.id;
    matchSnapshot = {
      id: target.id,
      status: target.status,
      kickoffAt: target.kickoffAt,
      predictionsLockAt: target.predictionsLockAt,
    };

    // Push the match's kickoff into the 2h window.
    const now = Date.now();
    await prisma.match.update({
      where: { id: target.id },
      data: {
        status: 'SCHEDULED',
        kickoffAt: new Date(now + 60 * 60 * 1000), // 1h from now
        predictionsLockAt: new Date(now + 50 * 60 * 1000), // not locked yet
        // Make sure both teams are set so the cron formats a label.
        // Use Argentina + Brazil from the seed teams; falling back to
        // homeTeamLabel string isn't enough for the cron's filter.
        homeTeamId: target.homeTeamId ?? (await firstTeamId(prisma)),
        awayTeamId:
          target.awayTeamId ??
          (await firstTeamId(prisma, target.homeTeamId ?? undefined)),
      },
    });

    // Create the three test users.
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('SeedPass123', 10);

    const eligible = await prisma.user.create({
      data: {
        dni: eligibleDni,
        firstName: 'Reminder',
        lastName: 'Eligible',
        whatsapp: `549${String(8_000_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: true,
        status: 'ACTIVE',
      },
    });
    eligibleUserId = eligible.id;

    const predicted = await prisma.user.create({
      data: {
        dni: predictedDni,
        firstName: 'Reminder',
        lastName: 'Predicted',
        whatsapp: `549${String(8_100_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: true,
        status: 'ACTIVE',
      },
    });
    predictedUserId = predicted.id;

    const optedOut = await prisma.user.create({
      data: {
        dni: optedOutDni,
        firstName: 'Reminder',
        lastName: 'OptOut',
        whatsapp: `549${String(8_200_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: false, // opted out — must NOT receive a reminder
        status: 'ACTIVE',
      },
    });
    optedOutUserId = optedOut.id;

    // Predicted user has a row for the target match.
    await prisma.prediction.create({
      data: {
        userId: predictedUserId,
        matchId: targetMatchId,
        scoreHome: 1,
        scoreAway: 1,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      // Wipe notifications for these users + match before deleting users
      // to satisfy ON DELETE CASCADE timing.
      await prisma.notification.deleteMany({
        where: {
          dedupKey: {
            startsWith: 'match-reminder:',
          },
          userId: { in: [eligibleUserId, predictedUserId, optedOutUserId] },
        },
      });
      await prisma.prediction.deleteMany({
        where: { userId: { in: [predictedUserId, eligibleUserId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [eligibleUserId, predictedUserId, optedOutUserId] } },
      });
      if (matchSnapshot) {
        await prisma.match.update({
          where: { id: matchSnapshot.id },
          data: {
            status: matchSnapshot.status as MatchSnapshot['status'],
            kickoffAt: matchSnapshot.kickoffAt,
            predictionsLockAt: matchSnapshot.predictionsLockAt,
          },
        });
      }
    }
    if (app) await app.close();
  }, 60_000);

  it('enqueues a Notification for the eligible user only', async () => {
    const enqueued = await cron.sendReminders();
    // We only assert >=1 because the test DB is shared and other matches
    // could also fall in the 2h window from leftover state — but this
    // user/match pair must produce exactly one row.
    expect(enqueued).toBeGreaterThanOrEqual(1);

    const eligibleRows = await prisma.notification.findMany({
      where: {
        userId: eligibleUserId,
        dedupKey: `match-reminder:${eligibleUserId}:${targetMatchId}`,
      },
    });
    expect(eligibleRows).toHaveLength(1);
    expect(eligibleRows[0].channel).toBe('WHATSAPP');
    expect(eligibleRows[0].type).toBe('MATCH_REMINDER');
    expect(eligibleRows[0].title).toBe('Recordatorio Prode');
    expect(eligibleRows[0].message).toContain('Faltan 2 horas');
    expect(eligibleRows[0].toAddress).toMatch(/^549/);

    // Predicted user must not have any reminder for this match.
    const predictedRows = await prisma.notification.findMany({
      where: {
        userId: predictedUserId,
        dedupKey: { startsWith: `match-reminder:${predictedUserId}:` },
      },
    });
    expect(predictedRows).toHaveLength(0);

    // Opted-out user must not have any reminder either.
    const optedOutRows = await prisma.notification.findMany({
      where: {
        userId: optedOutUserId,
        dedupKey: { startsWith: `match-reminder:${optedOutUserId}:` },
      },
    });
    expect(optedOutRows).toHaveLength(0);
  });

  it('is idempotent: re-running does not duplicate the reminder row', async () => {
    await cron.sendReminders();
    await cron.sendReminders();

    const rows = await prisma.notification.findMany({
      where: {
        userId: eligibleUserId,
        dedupKey: `match-reminder:${eligibleUserId}:${targetMatchId}`,
      },
    });
    expect(rows).toHaveLength(1);
  });
});

/**
 * Helper: pick any team id that's NOT excluded. The cron filters out
 * matches with null teams; the seed matches sometimes have nullable
 * placeholders depending on phase. Falling back to a real team id keeps
 * the test independent of seed state.
 */
async function firstTeamId(
  prisma: PrismaService,
  exclude?: string,
): Promise<string> {
  const team = await prisma.team.findFirstOrThrow({
    where: exclude ? { id: { not: exclude } } : {},
    orderBy: { fifaCode: 'asc' },
  });
  return team.id;
}
