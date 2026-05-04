import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { MatchesCron } from './matches.cron.js';

/**
 * Integration test for `MatchesCron.autoLockMatches`. We don't drive Nest's
 * scheduler (it would only fire at the top of the minute) — we call the
 * method directly the same way `PaymentsCron` is exercised in Phase 5.
 *
 * Strategy: pick an existing seed match, snapshot its state, push it into
 * the auto-lock window (status=SCHEDULED + predictionsLockAt in the past),
 * and assert the cron flips it to LOCKED. Restore on teardown.
 */
describe('MatchesCron.autoLockMatches (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cron: MatchesCron;

  type MatchSnapshot = {
    id: string;
    status: string;
    kickoffAt: Date;
    predictionsLockAt: Date;
  };
  const restoreList: MatchSnapshot[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    cron = app.get(MatchesCron);
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      for (const snap of restoreList) {
        await prisma.match.update({
          where: { id: snap.id },
          data: {
            status: snap.status as MatchSnapshot['status'],
            kickoffAt: snap.kickoffAt,
            predictionsLockAt: snap.predictionsLockAt,
          },
        });
      }
    }
    if (app) await app.close();
  }, 30_000);

  it('flips SCHEDULED matches with elapsed predictionsLockAt to LOCKED', async () => {
    // Use a high-numbered seed match so we don't conflict with other suites.
    const target = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 90 },
    });
    restoreList.push({
      id: target.id,
      status: target.status,
      kickoffAt: target.kickoffAt,
      predictionsLockAt: target.predictionsLockAt,
    });

    // Push it into the lock window: kickoff is ~5 min from now, lockAt is
    // ~5 min ago. Status forced to SCHEDULED so the cron treats it as
    // unlocked still.
    const now = Date.now();
    await prisma.match.update({
      where: { id: target.id },
      data: {
        status: 'SCHEDULED',
        predictionsLockAt: new Date(now - 5 * 60 * 1000),
        kickoffAt: new Date(now + 5 * 60 * 1000),
      },
    });

    const flipped = await cron.autoLockMatches();
    expect(flipped).toBeGreaterThanOrEqual(1);

    const after = await prisma.match.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.status).toBe('LOCKED');
  });

  it('does NOT touch matches whose lock is still in the future', async () => {
    const target = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 91 },
    });
    restoreList.push({
      id: target.id,
      status: target.status,
      kickoffAt: target.kickoffAt,
      predictionsLockAt: target.predictionsLockAt,
    });

    const now = Date.now();
    await prisma.match.update({
      where: { id: target.id },
      data: {
        status: 'SCHEDULED',
        predictionsLockAt: new Date(now + 60 * 60 * 1000),
        kickoffAt: new Date(now + 70 * 60 * 1000),
      },
    });

    await cron.autoLockMatches();

    const after = await prisma.match.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.status).toBe('SCHEDULED');
  });

  it('does NOT relock already-LOCKED or FINISHED matches', async () => {
    const target = await prisma.match.findFirstOrThrow({
      where: { matchNumber: 92 },
    });
    restoreList.push({
      id: target.id,
      status: target.status,
      kickoffAt: target.kickoffAt,
      predictionsLockAt: target.predictionsLockAt,
    });

    await prisma.match.update({
      where: { id: target.id },
      data: {
        status: 'FINISHED',
        predictionsLockAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await cron.autoLockMatches();

    const after = await prisma.match.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.status).toBe('FINISHED');
  });
});

/**
 * Integration test for `MatchesCron.lockSpecialPredictions`. Mirrors the
 * shape of the auto-lock test: spin up the app, snapshot match #1, push
 * its lock into the past, create a SpecialPrediction with `lockedAt=null`,
 * call the method, assert the row got stamped.
 *
 * SpecialPrediction has a unique constraint on `userId`, so we create a
 * one-off user inside the test and tear it down on completion.
 */
describe('MatchesCron.lockSpecialPredictions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cron: MatchesCron;

  // Track resources we create so afterAll can clean up reliably.
  const createdUserIds: string[] = [];
  type Match1Snapshot = {
    id: string;
    predictionsLockAt: Date;
    kickoffAt: Date;
    status: string;
  };
  let m1Snapshot: Match1Snapshot | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    cron = app.get(MatchesCron);

    const m1 = await prisma.match.findUniqueOrThrow({
      where: { matchNumber: 1 },
    });
    m1Snapshot = {
      id: m1.id,
      predictionsLockAt: m1.predictionsLockAt,
      kickoffAt: m1.kickoffAt,
      status: m1.status,
    };
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.specialPrediction.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      if (m1Snapshot) {
        await prisma.match.update({
          where: { id: m1Snapshot.id },
          data: {
            predictionsLockAt: m1Snapshot.predictionsLockAt,
            kickoffAt: m1Snapshot.kickoffAt,
            status: m1Snapshot.status as Match1Snapshot['status'],
          },
        });
      }
    }
    if (app) await app.close();
  }, 30_000);

  it('locks SpecialPrediction rows once match #1 lock has elapsed', async () => {
    // Force match #1 into the locked window.
    if (!m1Snapshot) throw new Error('m1Snapshot not initialised');
    await prisma.match.update({
      where: { id: m1Snapshot.id },
      data: {
        predictionsLockAt: new Date(Date.now() - 60 * 1000),
        // kickoff just behind the lock so the row stays internally consistent
        kickoffAt: new Date(Date.now() - 50 * 1000),
      },
    });

    // Create a user + SpecialPrediction with lockedAt = null.
    const suffix = Date.now().toString();
    const user = await prisma.user.create({
      data: {
        dni: `9${suffix.slice(-7)}`,
        whatsapp: `+5491100${suffix.slice(-6)}`,
        firstName: 'Special',
        lastName: 'Test',
        passwordHash: 'placeholder-not-used-here',
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(user.id);
    await prisma.specialPrediction.create({
      data: { userId: user.id, lockedAt: null },
    });

    const flipped = await cron.lockSpecialPredictions();
    expect(flipped).toBeGreaterThanOrEqual(1);

    const after = await prisma.specialPrediction.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(after.lockedAt).not.toBeNull();
  });

  it('returns 0 when match #1 lock is still in the future', async () => {
    if (!m1Snapshot) throw new Error('m1Snapshot not initialised');
    await prisma.match.update({
      where: { id: m1Snapshot.id },
      data: {
        predictionsLockAt: new Date(Date.now() + 24 * 3600 * 1000),
        kickoffAt: new Date(Date.now() + 25 * 3600 * 1000),
      },
    });

    // Create a fresh special prediction for a different user.
    const suffix = (Date.now() + 1).toString();
    const user = await prisma.user.create({
      data: {
        dni: `8${suffix.slice(-7)}`,
        whatsapp: `+5491101${suffix.slice(-6)}`,
        firstName: 'Special',
        lastName: 'Pending',
        passwordHash: 'placeholder-not-used-here',
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(user.id);
    await prisma.specialPrediction.create({
      data: { userId: user.id, lockedAt: null },
    });

    const flipped = await cron.lockSpecialPredictions();
    expect(flipped).toBe(0);

    const after = await prisma.specialPrediction.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(after.lockedAt).toBeNull();
  });
});
