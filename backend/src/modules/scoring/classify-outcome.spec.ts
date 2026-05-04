import { classifyOutcome } from './classify-outcome.js';

/**
 * Pure-function tests. We assert every branch of the spec table plus a
 * couple of edge cases (high-scoring blowout, away-side win) that have
 * historically tripped up sign-comparison implementations of this rule.
 */
describe('classifyOutcome', () => {
  const cases: Array<{
    label: string;
    prediction: [number, number];
    result: [number, number];
    expected: ReturnType<typeof classifyOutcome>;
  }> = [
    { label: '(2,1) vs (2,1) → EXACT', prediction: [2, 1], result: [2, 1], expected: 'EXACT' },
    { label: '(2,1) vs (3,2) → WINNER_AND_DIFF', prediction: [2, 1], result: [3, 2], expected: 'WINNER_AND_DIFF' },
    { label: '(2,1) vs (4,1) → WINNER_ONLY', prediction: [2, 1], result: [4, 1], expected: 'WINNER_ONLY' },
    { label: '(1,1) vs (2,2) → DRAW_DIFFERENT', prediction: [1, 1], result: [2, 2], expected: 'DRAW_DIFFERENT' },
    { label: '(1,1) vs (1,1) → EXACT', prediction: [1, 1], result: [1, 1], expected: 'EXACT' },
    { label: '(0,0) vs (1,1) → DRAW_DIFFERENT', prediction: [0, 0], result: [1, 1], expected: 'DRAW_DIFFERENT' },
    { label: '(2,1) vs (0,0) → MISS (predijo gana home, fue empate)', prediction: [2, 1], result: [0, 0], expected: 'MISS' },
    { label: '(2,1) vs (1,2) → MISS (gana opuesto)', prediction: [2, 1], result: [1, 2], expected: 'MISS' },
    { label: '(1,2) vs (3,2) → MISS (predijo away, ganó home)', prediction: [1, 2], result: [3, 2], expected: 'MISS' },
    { label: '(5,0) vs (1,0) → WINNER_ONLY (mismo ganador, diff distinta)', prediction: [5, 0], result: [1, 0], expected: 'WINNER_ONLY' },
    // Symmetry with the away side — rule must be neutral re: which team wins.
    { label: '(0,5) vs (0,1) → WINNER_ONLY (away win, diff distinta)', prediction: [0, 5], result: [0, 1], expected: 'WINNER_ONLY' },
    { label: '(1,3) vs (2,4) → WINNER_AND_DIFF (away win, mismo diff)', prediction: [1, 3], result: [2, 4], expected: 'WINNER_AND_DIFF' },
    // Predicted draw, actual non-draw → MISS regardless of which side won.
    { label: '(1,1) vs (2,0) → MISS', prediction: [1, 1], result: [2, 0], expected: 'MISS' },
    { label: '(1,1) vs (0,2) → MISS', prediction: [1, 1], result: [0, 2], expected: 'MISS' },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const actual = classifyOutcome(
        { scoreHome: c.prediction[0], scoreAway: c.prediction[1] },
        { scoreHome: c.result[0], scoreAway: c.result[1] },
      );
      expect(actual).toBe(c.expected);
    });
  }
});
