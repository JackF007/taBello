// Harder pieces through the whole engine, clean and as played by a person in a room.
import { describe, expect, it } from 'vitest';
import { chordLabels } from '../../src/renderer/src/lib/music/export';
import { COMPLEX_PIECES, renderComplex } from './complex';
import { transcribeAudio } from './engine';
import { compareWithScore } from './notation';

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Measured minimums (clean and performed). Before these tests, the Entertainer and Amazing Grace
// came out in D standard tuning with a capo on the 5th fret, and strummed chords lost a fifth of
// their notes (recall 80%). The funk bass line shows a known limit: Basic Pitch misses short notes
// on the low E string (E1), so a quarter of its notes are lost.
const MINIMUMS: Record<string, { precision: number; recall: number; durations: number; barLines: boolean }> = {
  'bach-prelude': { precision: 0.95, recall: 0.95, durations: 0.85, barLines: false },
  entertainer: { precision: 0.9, recall: 0.95, durations: 0.85, barLines: true },
  'amazing-grace': { precision: 0.9, recall: 0.95, durations: 0.95, barLines: true },
  'funk-bass': { precision: 0.7, recall: 0.6, durations: 0.5, barLines: false },
  // Strings struck again while ringing are recovered from the strum (recall 95% → 96–97%).
  strumming: { precision: 0.95, recall: 0.95, durations: 0.95, barLines: true },
};

describe('complex pieces', () => {
  it.each(COMPLEX_PIECES.flatMap((p) => [[p.id, false], [p.id, true]] as const))('%s (performed: %s)', { timeout: 300_000 }, async (id, performed) => {
    const { piece, instrument, chords, bpm } = COMPLEX_PIECES.find((p) => p.id === id)!;
    let r = await transcribeAudio(renderComplex(piece, performed), instrument);
    // A stream of 16ths can be heard as 8ths at twice the tempo; the ½× button fixes it.
    const halved = Math.abs(r.tempo.bpm / bpm - 2) < 0.1;
    if (halved) r = await transcribeAudio(new Float32Array(), instrument, { tempoScale: 0.5, notes: r.notes });
    const score = compareWithScore(r.arrangement, piece);
    // Chord names as heard (a capo changes the shapes, not the harmony).
    const labels = chordLabels(r.arrangement, r.tuning.strings, r.instrument.frets, 0, r.key.flats, instrument !== 'ukulele');
    const names = labels.flat().filter((l) => l !== null).map((l) => l.name);
    console.log(
      JSON.stringify({
        id, performed, bpm: Math.round(r.tempo.bpm), halved, meter: r.meter.meter, tuning: r.tuning.id, capo: r.capo,
        notes: `${score.writtenNotes}/${score.truthNotes}`, precision: pct(score.precision), recall: pct(score.recall),
        durations: pct(score.durations), barLines: score.barLines, shortRests: score.shortRests, chords: names.join(' '),
      }),
    );
    const minimum = MINIMUMS[id];
    expect(Math.abs(r.tempo.bpm - bpm)).toBeLessThan(2);
    expect(r.tuning.id).toBe('standard');
    expect(r.capo).toBe(0);
    expect(score.precision).toBeGreaterThanOrEqual(minimum.precision);
    expect(score.recall).toBeGreaterThanOrEqual(minimum.recall);
    expect(score.durations).toBeGreaterThanOrEqual(minimum.durations);
    if (minimum.barLines) expect(score.barLines).toBe(true);
    if (chords) expect(names.join(' ')).toBe(chords.join(' '));
  });
});
