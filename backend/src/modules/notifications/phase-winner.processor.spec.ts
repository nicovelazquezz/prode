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
 * Integration test for `PhaseWinnerProcessor.handle`. Multi-prode era:
 * the job payload carries entryId, the dedup key is keyed by entry, and
 * the processor resolves the human user via Entry.userId.
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
  let winnerEntryId: string;
  let optedOutEntryId: string;

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

    async function makeUserWithEntry(args: {
      dni: string;
      lastName: string;
      whatsapp: string;
      whatsappOptIn: boolean;
    }): Promise<{ userId: string; entryId: string }> {
      const u = await prisma.user.create({
        data: {
          dni: args.dni,
          firstName: 'Phase',
          lastName: args.lastName,
          whatsapp: args.whatsapp,
          passwordHash,
          whatsappOptIn: args.whatsappOptIn,
        },
      });
      const pmt = await prisma.payment.create({
        data: {
          userId: u.id,
          amount: 10_000,
          method: 'CASH',
          status: 'APPROVED',
          paidAt: new Date(),
          completedAt: new Date(),
        },
      });
      const entry = await prisma.entry.create({
        data: {
          userId: u.id,
          paymentId: pmt.id,
          position: 1,
          status: 'ACTIVE',
        },
      });
      return { userId: u.id, entryId: entry.id };
    }

    const winner = await makeUserWithEntry({
      dni: winnerDni,
      lastName: 'Winner',
      whatsapp: `549${String(8_700_000_000 + stamp).slice(-9)}`.slice(0, 13),
      whatsappOptIn: true,
    });
    winnerId = winner.userId;
    winnerEntryId = winner.entryId;

    const optedOut = await makeUserWithEntry({
      dni: optedOutDni,
      lastName: 'OptOut',
      whatsapp: `549${String(8_800_000_000 + stamp).slice(-9)}`.slice(0, 13),
      whatsappOptIn: false,
    });
    optedOutId = optedOut.userId;
    optedOutEntryId = optedOut.entryId;

    // Seed PhaseWinner row for THIRD_PLACE pointing at the winner's entry.
    // `phase` is unique → upsert so reruns survive.
    await prisma.phaseWinner.upsert({
      where: { phase: PHASE },
      create: { phase: PHASE, entryId: winnerEntryId, pointsEarned: POINTS },
      update: { entryId: winnerEntryId, pointsEarned: POINTS },
    });
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.notification.deleteMany({
        where: {
          dedupKey: {
            in: [
              `phase-winner:${PHASE}:${winnerEntryId}`,
              `phase-winner:${PHASE}:${optedOutEntryId}`,
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

  it('enqueues a WhatsApp Notification for an opted-in winner entry', async () => {
    const sent = await processor.handle(
      makeJob({ phase: PHASE, entryId: winnerEntryId }),
    );
    expect(sent).toBe(true);

    const dedupKey = `phase-winner:${PHASE}:${winnerEntryId}`;
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
    await processor.handle(makeJob({ phase: PHASE, entryId: winnerEntryId }));
    await processor.handle(makeJob({ phase: PHASE, entryId: winnerEntryId }));

    const dedupKey = `phase-winner:${PHASE}:${winnerEntryId}`;
    const rows = await prisma.notification.findMany({ where: { dedupKey } });
    expect(rows).toHaveLength(1);
  });

  it('skips when the entry owner opted out of WhatsApp', async () => {
    await prisma.phaseWinner.update({
      where: { phase: PHASE },
      data: { entryId: optedOutEntryId },
    });

    const sent = await processor.handle(
      makeJob({ phase: PHASE, entryId: optedOutEntryId }),
    );
    expect(sent).toBe(false);

    const optedOutKey = `phase-winner:${PHASE}:${optedOutEntryId}`;
    const row = await prisma.notification.findUnique({
      where: { dedupKey: optedOutKey },
    });
    expect(row).toBeNull();

    await prisma.phaseWinner.update({
      where: { phase: PHASE },
      data: { entryId: winnerEntryId },
    });
  });

  it('skips on a stale job whose entryId no longer matches the PhaseWinner row', async () => {
    const sent = await processor.handle(
      makeJob({ phase: PHASE, entryId: optedOutEntryId }), // mismatched
    );
    expect(sent).toBe(false);
  });

  it('skips when the entry does not exist', async () => {
    const sent = await processor.handle(
      makeJob({ phase: PHASE, entryId: 'nonexistent_entry_id' }),
    );
    expect(sent).toBe(false);
  });
});
