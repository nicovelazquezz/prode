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
