import { describe, expect, it } from 'vitest';
import { transcribeSample } from './engine';
import { compareWithScore, type NotationScore } from './notation';
import { PIECES } from './scores';
import { getSample } from '../../src/shared/samples';

const pct = (v: number) => `${Math.round(v * 100)}%`;

describe('notation quality on the samples', () => {
  it('writes what the score says', { timeout: 300_000 }, async () => {
    const rows: Record<string, Record<string, string | number | boolean>> = {};
    const scores: Record<string, NotationScore> = {};
    for (const id of ['greensleeves', 'romance', 'minuet', 'ode-to-joy']) {
      const piece = PIECES.find((p) => p.file === getSample(id)!.file)!;
      const { arrangement } = await transcribeSample(id);
      const score = compareWithScore(arrangement, piece);
      scores[id] = score;
      rows[id] = {
        notes: `${score.writtenNotes}/${score.truthNotes}`,
        precision: pct(score.precision),
        recall: pct(score.recall),
        durations: pct(score.durations),
        barLines: score.barLines,
        shortRests: score.shortRests,
      };
    }
    console.table(rows);
    // Before the echo merging, gap filling and strum alignment, Greensleeves had 64 notes for 52
    // (precision 81%, durations 85%, 7 short rests).
    for (const score of Object.values(scores)) {
      expect(score.barLines).toBe(true);
      expect(score.precision).toBeGreaterThanOrEqual(0.93);
      expect(score.recall).toBeGreaterThanOrEqual(0.93);
      expect(score.durations).toBeGreaterThanOrEqual(0.95);
      expect(score.shortRests).toBe(0);
    }
  });
});
