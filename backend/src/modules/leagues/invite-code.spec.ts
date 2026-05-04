import { jest } from '@jest/globals';
import {
  generateInviteCode,
  generateUniqueInviteCode,
} from './invite-code.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Pure-unit tests for the invite-code helpers — no Prisma, no DB. The
 * collision-loop test stubs `prisma.league.findUnique` so we can drive
 * the retry path deterministically.
 */
describe('invite-code', () => {
  // The alphabet excludes 0/O/1/I/L. Anything outside this character class
  // would mean we leaked an ambiguous glyph into a generated code.
  const ALPHABET_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

  describe('generateInviteCode', () => {
    it('returns a 6-character string drawn from the safe alphabet', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateInviteCode();
        expect(code).toHaveLength(6);
        expect(code).toMatch(ALPHABET_REGEX);
      }
    });

    it('produces statistically-distinct codes across many calls', () => {
      // 1000 generations should yield ~1000 distinct codes given the 30^6
      // (=729M) keyspace. We assert ≥ 990 unique to leave a tiny margin
      // for the (vanishingly small) birthday-paradox collision rate while
      // still catching a regression that breaks randomness (e.g. seeds
      // being reused, alphabet shrinking).
      const codes = new Set<string>();
      for (let i = 0; i < 1000; i++) codes.add(generateInviteCode());
      expect(codes.size).toBeGreaterThanOrEqual(990);
    });
  });

  describe('generateUniqueInviteCode', () => {
    it('returns the first generated code when no collision exists', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = {
        league: { findUnique },
      } as unknown as PrismaService;

      const code = await generateUniqueInviteCode(prisma);
      expect(code).toMatch(ALPHABET_REGEX);
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('retries on collision and eventually returns a non-colliding code', async () => {
      // Simulate the first three attempts colliding, then a free slot.
      const findUnique = jest
        .fn()
        .mockResolvedValueOnce({ id: 'a' })
        .mockResolvedValueOnce({ id: 'b' })
        .mockResolvedValueOnce({ id: 'c' })
        .mockResolvedValueOnce(null);
      const prisma = {
        league: { findUnique },
      } as unknown as PrismaService;

      const code = await generateUniqueInviteCode(prisma);
      expect(code).toMatch(ALPHABET_REGEX);
      expect(findUnique).toHaveBeenCalledTimes(4);
    });

    it('throws after 5 consecutive collisions', async () => {
      // Always collide. This branch is astronomically unlikely in practice
      // — the test exercises the bail-out wiring, not a real-world risk.
      const findUnique = jest.fn().mockResolvedValue({ id: 'always' });
      const prisma = {
        league: { findUnique },
      } as unknown as PrismaService;

      await expect(generateUniqueInviteCode(prisma)).rejects.toThrow(
        'Could not generate unique invite code',
      );
      expect(findUnique).toHaveBeenCalledTimes(5);
    });
  });
});
