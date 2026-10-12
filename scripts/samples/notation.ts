// Compares a written arrangement with the true score, the way a musician would read it.
import { meterTicks, type Arrangement } from '../../src/renderer/src/lib/music/arrange';
import type { Piece } from './scores';

export interface WrittenNote {
  pitch: number;
  /** Position and length in beats from the start of bar 1 of the arrangement. */
  beat: number;
  beats: number;
}

/** The notes as written: tied pieces joined, positions in beats. */
export function writtenNotes(arrangement: Arrangement): WrittenNote[] {
  const ticks = meterTicks(arrangement.meter);
  const notes: WrittenNote[] = [];
  const open = new Map<number, WrittenNote>(); // by string
  let tick = 0;
  for (const bar of arrangement.bars) {
    for (const beat of bar) {
      const length = (48 / beat.value) * (beat.dotted ? 1.5 : 1) * (beat.tuplet ? 2 / 3 : 1);
      for (const note of beat.notes) {
        const existing = open.get(note.string);
        if (note.tied && existing) existing.beats += length / ticks.beat;
        else {
          const written = { pitch: note.pitch, beat: tick / ticks.beat, beats: length / ticks.beat };
          notes.push(written);
          open.set(note.string, written);
        }
      }
      for (const string of [...open.keys()]) if (!beat.notes.some((n) => n.string === string)) open.delete(string);
      tick += length;
    }
  }
  return notes;
}

export interface NotationScore {
  truthNotes: number;
  writtenNotes: number;
  /** Notes written with the right pitch exactly where the score has them. */
  precision: number;
  recall: number;
  /** Of those, the share written with the right length (the time to the next note, in one voice). */
  durations: number;
  /** Bar lines where the score has them, with the right number of beats. */
  barLines: boolean;
  /** Rests shorter than a beat: clutter a musician would not write. */
  shortRests: number;
}

export function compareWithScore(arrangement: Arrangement, piece: Piece): NotationScore {
  const truth = piece.parts
    .filter((p) => p.kind === 'strings')
    .flatMap((p) => p.notes)
    .filter((n) => n.beat !== undefined)
    .map((n) => ({ pitch: n.pitch, beat: n.beat!, beats: n.beats! }))
    // The same pitch at the same time (melody doubling a chord tone) is played once.
    .filter((n, i, all) => all.findIndex((o) => o.pitch === n.pitch && Math.abs(o.beat - n.beat) < 1e-6) === i);
  // In one voice a note is written up to the next onset (or its end, if earlier).
  const onsets = [...new Set(truth.map((n) => n.beat))].sort((a, b) => a - b);
  const expected = truth.map((n) => {
    const next = onsets.find((o) => o > n.beat + 1e-6);
    return { ...n, beats: Math.min(n.beats, next === undefined ? Infinity : next - n.beat) };
  });
  const written = writtenNotes(arrangement);

  // Align the arrangement with the score on the offset (in score slots) that matches most notes.
  const slot = 1 / 12;
  let best = { offset: 0, matches: 0 };
  for (let k = -12 * 8; k <= 12 * 8; k++) {
    const offset = k * slot;
    const matches = expected.filter((t) => written.some((w) => w.pitch === t.pitch && Math.abs(w.beat - (t.beat + offset)) < 1e-3)).length;
    if (matches > best.matches) best = { offset, matches };
  }
  const used = new Set<WrittenNote>();
  let durationsRight = 0;
  for (const t of expected) {
    const w = written.find((n) => !used.has(n) && n.pitch === t.pitch && Math.abs(n.beat - (t.beat + best.offset)) < 1e-3);
    if (!w) continue;
    used.add(w);
    if (Math.abs(w.beats - t.beats) < 1e-3) durationsRight++;
  }
  const matched = used.size;
  const firstBar = best.offset + piece.pickup;
  const barLines = arrangement.meter.beatsPerBar === piece.beatsPerBar && Math.abs(firstBar / piece.beatsPerBar - Math.round(firstBar / piece.beatsPerBar)) < 1e-3;
  const ticks = meterTicks(arrangement.meter);
  const shortRests = arrangement.bars.flat().filter((b) => b.notes.length === 0 && (48 / b.value) * (b.dotted ? 1.5 : 1) * (b.tuplet ? 2 / 3 : 1) < ticks.beat).length;
  return {
    truthNotes: expected.length,
    writtenNotes: written.length,
    precision: written.length ? matched / written.length : 0,
    recall: expected.length ? matched / expected.length : 0,
    durations: matched ? durationsRight / matched : 0,
    barLines,
    shortRests,
  };
}
