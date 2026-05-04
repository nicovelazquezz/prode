import { MatchesService } from './matches.service.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';

/**
 * Pure unit test for the `recomputeLockAt` helper. The service is otherwise
 * exercised through the integration suite (`matches.controller.spec.ts`),
 * but this method is a tiny stateless function — best covered with a
 * focused unit test that doesn't need the Nest container.
 */
describe('MatchesService.recomputeLockAt', () => {
  // The helper doesn't touch Prisma or audit, so we hand the constructor
  // empty stubs. Casting through `unknown` keeps strict mode happy without
  // requiring a real test module.
  const service = new MatchesService(
    {} as unknown as PrismaService,
    {} as unknown as AuditService,
  );

  it('subtracts exactly 10 minutes from the kickoff time', () => {
    const kickoff = new Date('2026-06-11T20:00:00.000Z');
    const lock = service.recomputeLockAtForTest(kickoff);
    expect(lock.toISOString()).toBe('2026-06-11T19:50:00.000Z');
  });

  it('preserves millisecond precision', () => {
    const kickoff = new Date('2026-06-11T20:00:00.123Z');
    const lock = service.recomputeLockAtForTest(kickoff);
    expect(lock.toISOString()).toBe('2026-06-11T19:50:00.123Z');
  });

  it('does not mutate the input Date', () => {
    const kickoff = new Date('2026-06-11T20:00:00.000Z');
    const before = kickoff.getTime();
    service.recomputeLockAtForTest(kickoff);
    expect(kickoff.getTime()).toBe(before);
  });

  it('handles a kickoff right at the unix epoch', () => {
    const kickoff = new Date(0);
    const lock = service.recomputeLockAtForTest(kickoff);
    expect(lock.getTime()).toBe(-10 * 60 * 1000);
  });
});
