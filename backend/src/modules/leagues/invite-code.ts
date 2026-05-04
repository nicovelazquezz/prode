import { randomInt } from 'node:crypto';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';

/**
 * Alphabet for invite codes. Excludes visually ambiguous glyphs (`0`/`O`,
 * `1`/`I`/`L`) so users can read codes off a phone screen without
 * second-guessing — important because they're typed manually into the
 * "Join league" form. 30 symbols × 6 positions = 30^6 ≈ 729M combinations,
 * which is plenty of headroom for the spec's <200-user scale (collision
 * probability per generation under load is < 1e-6).
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L

/**
 * Maximum number of generation attempts before giving up. Five is
 * astronomically conservative — at the spec's expected scale (<200
 * leagues) the per-attempt collision probability is well under 1e-6, so
 * the chance of five consecutive collisions is sub-1e-30. The retry exists
 * purely to keep the function total in the face of a unique constraint
 * violation that could otherwise surface as a 500 to the user.
 */
const MAX_ATTEMPTS = 5;

/**
 * Generates a single 6-character invite code drawn uniformly from
 * {@link ALPHABET}. `randomInt` from `node:crypto` is CSPRNG-backed —
 * `Math.random()` would be sufficient for collision avoidance but the
 * spec calls out auditability of invite codes (no predicting the next
 * one), and the perf cost is negligible at this volume.
 */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * Generates an invite code that does not collide with any existing
 * `League.inviteCode`. Reties up to {@link MAX_ATTEMPTS} times — an
 * unrecoverable collision streak throws so the caller surfaces a 500
 * rather than silently duplicating a code (the unique constraint would
 * catch it on insert anyway, but this gives a more useful error path).
 */
export async function generateUniqueInviteCode(
  prisma: PrismaService,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateInviteCode();
    const existing = await prisma.league.findUnique({
      where: { inviteCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error('Could not generate unique invite code');
}
