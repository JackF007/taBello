// Fast passages: 16th-note scale runs, picked, at increasing tempos.
import { describe, expect, it } from 'vitest';
import { matchNotes, noteScores } from '../../benchmark/guitarset/metrics';
import { detectNotes } from '../../src/main/transcription/pipeline';
import { renderStrings } from '../../src/main/transcription/testing/strings';
import { assets } from './engine';

describe('fast passages', () => {
  it.each([
    [120, 0.85],
    [140, 0.8],
    [160, 0.65],
  ])('finds the notes of 16th-note runs at %i BPM', { timeout: 120_000 }, async (bpm, minRecall) => {
    const step = 60 / bpm / 4;
    const scale = [57, 59, 60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60, 59];
    const truth = Array.from({ length: 48 }, (_, i) => ({ start: 0.3 + i * step, duration: step * 0.98, pitch: scale[i % scale.length], velocity: 1 }));
    const notes = await detectNotes(renderStrings(truth.map((n) => ({ ...n, amplitude: 0.5 })), 0.6 + 48 * step), { assets, minHz: 70, maxHz: 1400 });
    const scores = noteScores(truth.length, notes.length, matchNotes(truth, notes).length);
    // Before the short-note pass: recall 0.73 / 0.17 / 0.15.
    expect(scores.recall).toBeGreaterThanOrEqual(minRecall);
    expect(scores.precision).toBeGreaterThanOrEqual(0.95);
  });
});
