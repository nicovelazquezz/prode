import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  PHASE_WINNER_JOB,
  PhaseWinnerProcessor,
  type PhaseWinnerJobData,
} from './phase-winner.processor.js';

/**
 * Integration test for `PhaseWinnerProcessor.handle`. The handler is
 * fed by `PhaseService.maybeClosePhase` in production; here we drive
 * it directly with a synthesised job so we can pin the exact branch
 * coverage without spinning up the whole scoring pipeline.
 *
 * We use a phase that the seed doesn't normally close (THIRD_PLACE) so
 * we don't collide with whatever `phase.service.integration.spec.ts`
 * sets up for GROUPS.
 */
describe('PhaseWinnerProcessor.handle (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: PhaseWinnerProcessor;

  const stamp = Date.now();
  const winnerDni = `45${String(stamp).slice(-7)}`;
  const optedOutDni = `46${String(stamp).slice(-7)}`;

  let winnerId: string;
  let optedOutId: string;

  const PHASE = 'THIRD_PLACE' as const;
  const POINTS = 137;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    processor = app.get(PhaseWinnerProcessor);

    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('SeedPass123', 10);

    const winner = await prisma.user.create({
      data: {
        dni: winnerDni,
        firstName: 'Phase',
        lastName: 'Winner',
        whatsapp: `549${String(8_700_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: true,
      },
    });
    winnerId = winner.id;

    const optedOut = await prisma.user.create({
      data: {
        dni: optedOutDni,
        firstName: 'Phase',
        lastName: 'OptOut',
        whatsapp: `549${String(8_800_000_000 + stamp).slice(-9)}`.slice(0, 13),
        passwordHash,
        whatsappOptIn: false,
      },
    });
    optedOutId = optedOut.id;

    // Seed PhaseWinner row for THIRD_PLACE pointing at the winner.
    // `phase` is unique → upsert so reruns survive.
    await prisma.phaseWinner.upsert({
      where: { phase: PHASE },
      create: { phase: PHASE, userId: winnerId, pointsEarned: POINTS },
      update: { userId: winnerId, pointsEarned: POINTS },
    });
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.notification.deleteMany({
        where: {
          dedupKey: {
            in: [
              `phase-winner:${PHASE}:${winnerId}`,
              `phase-winner:${PHASE}:${optedOutId}`,
            ],
          },
        },
      });
      await prisma.phaseWinner.deleteMany({ where: { phase: PHASE } });
      await prisma.user.deleteMany({
        where: { id: { in: [winnerId, optedOutId] } },
      });
    }
    if (app) await app.close();
  }, 30_000);

  function makeJob(data: PhaseWinnerJobData): Job<PhaseWinnerJobData> {
    return {
      id: 'pw_test',
      name: PHASE_WINNER_JOB,
      data,
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as unknown as Job<PhaseWinnerJobData>;
  }

  it('enqueues a WhatsApp Notification for an opted-in winner', async () => {
    const sent = await processor.handle(
      makeJob({ phase: PHASE, userId: winnerId }),
    );
    expect(sent).toBe(true);

    const dedupKey = `phase-winner:${PHASE}:${winnerId}`;
    const row = await prisma.notification.findUnique({ where: { dedupKey } });
    expect(row).not.toBeNull();
    expect(row?.channel).toBe('WHATSAPP');
    expect(row?.type).toBe('PHASE_WINNER');
    expect(row?.title).toBe('¡Ganaste un premio del Prode!');
    expect(row?.message).toContain('Felicitaciones Phase');
    expect(row?.message).toContain(`${POINTS} pts`);
    expect(row?.message).toContain('Tercer puesto');
    expect(row?.userId).toBe(winnerId);
    expect(row?.toAddress).toMatch(/^549/);
  });

  it('is idempotent: re-running the same job does not produce a duplicate row', async () => {
    await processor.handle(makeJob({ phase: PHASE, userId: winnerId }));
    await processor.handle(makeJob({ phase: PHASE, userId: winnerId }));

    const dedupKey = `phase-winner:${PHASE}:${winnerId}`;
    const rows = await prisma.notification.findMany({ where: { dedupKey } });
    expect(rows).toHaveLength(1);
  });

  it('skips when the user opted out of WhatsApp', async () => {
    // Repoint the PhaseWinner row at the opted-out user for this assertion.
    await prisma.phaseWinner.update({
      where: { phase: PHASE },
      data: { userId: optedOutId },
    });

    const sent = await processor.handle(
      makeJob({ phase: PHASE, userId: optedOutId }),
    );
    expect(sent).toBe(false);

    const optedOutKey = `phase-winner:${PHASE}:${optedOutId}`;
    const row = await prisma.notification.findUnique({
      where: { dedupKey: optedOutKey },
    });
    expect(row).toBeNull();

    // Restore for the next assertion.
    await prisma.phaseWinner.update({
      where: { phase: PHASE },
      data: { userId: winnerId },
    });
  });

  it('skips on a stale job whose userId no longer matches the PhaseWinner row', async () => {
    const sent = await processor.handle(
      makeJob({ phase: PHASE, userId: optedOutId }), // mismatched
    );
    expect(sent).toBe(false);
  });

  it('skips when the user does not exist', async () => {
    const sent = await processor.handle(
      makeJob({ phase: PHASE, userId: 'nonexistent_user_id' }),
    );
    expect(sent).toBe(false);
  });
});
