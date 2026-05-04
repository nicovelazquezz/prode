import type { OutcomeType } from '../../../generated/prisma/enums.js';

/**
 * Pure outcome classifier (spec section 6.3). Returns one of the five
 * `OutcomeType` enum values for a given prediction vs result pair.
 *
 * Hierarchy from most-specific to least-specific:
 *   - EXACT             → both scores match.
 *   - DRAW_DIFFERENT    → both predicted and actual were draws but with
 *                          different scoreline.
 *   - WINNER_AND_DIFF   → predicted the right winner AND the same goal
 *                          difference (e.g. 2-1 vs 3-2).
 *   - WINNER_ONLY       → predicted the right winner but with a different
 *                          goal difference (e.g. 5-0 vs 1-0).
 *   - MISS              → wrong winner (or predicted draw when there was
 *                          a winner / vice-versa).
 *
 * Kept as a free function (no class wrapper, no DI) so it stays trivial to
 * unit-test and reuse from non-Nest contexts (CLI tools, future bulk
 * recompute scripts, etc.). The shape parameters are intentionally narrow:
 * we don't take a full `Prediction` so we never accidentally read fields
 * that haven't been validated yet (e.g. `outcomeType` from a stale row).
 */
export function classifyOutcome(
  prediction: { scoreHome: number; scoreAway: number },
  result: { scoreHome: number; scoreAway: number },
): OutcomeType {
  const ph = prediction.scoreHome;
  const pa = prediction.scoreAway;
  const rh = result.scoreHome;
  const ra = result.scoreAway;

  if (ph === rh && pa === ra) return 'EXACT';

  const predDiff = ph - pa;
  const realDiff = rh - ra;

  // Both were draws but the predicted scoreline differs (handled before
  // the EXACT branch already shortcut on equality).
  if (predDiff === 0 && realDiff === 0) return 'DRAW_DIFFERENT';

  // Same sign of the difference ⇒ same winner. Math.sign handles 0
  // (already excluded above) and -0 ⇒ 0 normalisation transparently.
  if (Math.sign(predDiff) === Math.sign(realDiff)) {
    return predDiff === realDiff ? 'WINNER_AND_DIFF' : 'WINNER_ONLY';
  }

  return 'MISS';
}
