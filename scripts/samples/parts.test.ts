// Melody and accompaniment: the melody notes found in transcribed recordings whose melody is known.
import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../../src/shared/ipc';
import { getSample } from '../../src/shared/samples';
import { melodyNotes } from '../../src/renderer/src/lib/music/parts';
import { COMPLEX_PIECES, renderComplex } from './complex';
import { transcribeAudio, transcribeSample } from './engine';
import { PIECES, type Piece } from './scores';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Precision and recall of the notes put in the melody. The melody is a score's first part; in a
 * single part (fingerstyle), the notes played louder (0.55).
 */
function melodyScore(notes: NoteEvent[], piece: Piece) {
  const truth = piece.parts.flatMap((p, k) => p.notes.map((n) => ({ ...n, melody: piece.parts.length > 1 ? k === 0 : n.amplitude === 0.55 })));
  const melody = melodyNotes(notes);
  let found = 0;
  let foundRight = 0;
  let truthMelody = 0;
  let truthFound = 0;
  notes.forEach((note, i) => {
    const match = truth.find((t) => t.pitch === note.pitch && Math.abs(t.start - note.start) < 0.06);
    if (!match) return;
    if (melody[i]) {
      found++;
      if (match.melody) foundRight++;
    }
    if (match.melody) {
      truthMelody++;
      if (melody[i]) truthFound++;
    }
  });
  return { precision: found ? foundRight / found : 0, recall: truthMelody ? truthFound / truthMelody : 0 };
}

const CASES: [string, () => Promise<{ notes: NoteEvent[]; piece: Piece }>, number][] = [
  ...['greensleeves', 'romance', 'minuet', 'ode-to-joy'].map(
    (id) => [id, async () => ({ notes: (await transcribeSample(id)).notes, piece: PIECES.find((p) => p.file === getSample(id)!.file)! }), id === 'ode-to-joy' ? 0.85 : 0.9] as [string, () => Promise<{ notes: NoteEvent[]; piece: Piece }>, number],
  ),
  ...['entertainer', 'amazing-grace'].map((id) => {
    const { piece, instrument } = COMPLEX_PIECES.find((p) => p.id === id)!;
    return [id, async () => ({ notes: (await transcribeAudio(renderComplex(piece, true), instrument)).notes, piece }), 0.9] as [string, () => Promise<{ notes: NoteEvent[]; piece: Piece }>, number];
  }),
];

describe('melody and accompaniment', () => {
  it.each(CASES)('%s', { timeout: 300_000 }, async (id, load, minimum) => {
    const { notes, piece } = await load();
    const { precision, recall } = melodyScore(notes, piece);
    console.log(`${id}: melody precision ${pct(precision)}, recall ${pct(recall)}`);
    expect(precision).toBeGreaterThanOrEqual(minimum);
    expect(recall).toBeGreaterThanOrEqual(minimum);
  });
});
