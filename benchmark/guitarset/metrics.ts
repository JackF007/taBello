// Note-level transcription metrics (as mir_eval's onset-only note F-measure) and tab metrics.
import type { NoteEvent } from '../../src/shared/ipc';
import type { Arrangement, PlacedNote } from '../../src/renderer/src/lib/music/arrange';
import type { ReferenceNote } from './jams';

/** Pairs (reference index, estimate index) of notes with the same pitch and onsets within the tolerance. */
export function matchNotes(reference: NoteEvent[], estimate: NoteEvent[], tolerance = 0.05): [number, number][] {
  const candidates: { r: number; e: number; distance: number }[] = [];
  reference.forEach((ref, r) => {
    estimate.forEach((est, e) => {
      const distance = Math.abs(ref.start - est.start);
      if (ref.pitch === est.pitch && distance <= tolerance) candidates.push({ r, e, distance });
    });
  });
  // Greedy by distance: close to the optimal one-to-one matching for well-separated notes.
  candidates.sort((a, b) => a.distance - b.distance);
  const usedR = new Set<number>();
  const usedE = new Set<number>();
  const matches: [number, number][] = [];
  for (const { r, e } of candidates) {
    if (usedR.has(r) || usedE.has(e)) continue;
    usedR.add(r);
    usedE.add(e);
    matches.push([r, e]);
  }
  return matches;
}

export interface Scores {
  precision: number;
  recall: number;
  f1: number;
}

export function noteScores(referenceCount: number, estimateCount: number, matchCount: number): Scores {
  const precision = estimateCount === 0 ? 0 : matchCount / estimateCount;
  const recall = referenceCount === 0 ? 0 : matchCount / referenceCount;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/**
 * Of the correctly detected notes, the share placed on the string the guitarist used.
 * `matches` pairs reference notes with the notes the arrangement was made from.
 */
export function stringAccuracy(reference: ReferenceNote[], arrangement: Arrangement, matches: [number, number][]): number {
  const placedBySource = new Map<number, PlacedNote>();
  for (const beat of arrangement.bars.flat()) {
    for (const note of beat.notes) {
      if (!note.tied) for (const source of note.sources) placedBySource.set(source, note);
    }
  }
  const placed = matches.filter(([, e]) => placedBySource.has(e));
  if (placed.length === 0) return 0;
  return placed.filter(([r, e]) => placedBySource.get(e)!.string === reference[r].string).length / placed.length;
}
