// Turns detected notes (real time) into a playable tablature arrangement:
// quantize to a 16th-note grid → group into chords → pick strings/frets → split into 4/4 bars.
import type { NoteEvent } from '../../../../shared/ipc';

export const SLOTS_PER_BEAT = 4; // 16th notes
export const BEATS_PER_BAR = 4; // 4/4
export const SLOTS_PER_BAR = SLOTS_PER_BEAT * BEATS_PER_BAR;

export interface PlacedNote {
  /** String index, 0 = lowest-pitched string. */
  string: number;
  fret: number;
  pitch: number;
  /** Continuation of the same note from the previous beat (a tie). */
  tied: boolean;
}

export type NoteValue = 1 | 2 | 4 | 8 | 16;

export interface TabBeat {
  /** Empty for a rest. */
  notes: PlacedNote[];
  value: NoteValue;
  dotted: boolean;
}

export interface Arrangement {
  bars: TabBeat[][];
  /** Notes that could not be placed (e.g. more simultaneous notes than strings). */
  droppedNotes: number;
}

export interface ArrangeOptions {
  /** Open-string MIDI pitches, lowest string first. */
  tuning: number[];
  frets: number;
  bpm: number;
  /** Time in seconds of a beat; aligns the grid with the music. */
  offset: number;
}

interface Chord {
  slot: number;
  endSlot: number;
  pitches: { pitch: number; velocity: number }[];
}

interface Fingering {
  notes: PlacedNote[];
  cost: number;
  /** Lowest fretted position, or null when only open strings are played (the hand can move freely). */
  position: number | null;
}

// Durations that fit a 4/4 bar, in 16th-note slots, largest first.
const DURATIONS: { slots: number; value: NoteValue; dotted: boolean }[] = [
  { slots: 16, value: 1, dotted: false },
  { slots: 12, value: 2, dotted: true },
  { slots: 8, value: 2, dotted: false },
  { slots: 6, value: 4, dotted: true },
  { slots: 4, value: 4, dotted: false },
  { slots: 3, value: 8, dotted: true },
  { slots: 2, value: 8, dotted: false },
  { slots: 1, value: 16, dotted: false },
];

const MAX_CANDIDATES = 12;

/** Moves a pitch by octaves into the instrument's playable range. */
function foldIntoRange(pitch: number, lowest: number, highest: number): number {
  while (pitch < lowest) pitch += 12;
  while (pitch > highest) pitch -= 12;
  return pitch;
}

function quantize(notes: NoteEvent[], options: ArrangeOptions): Chord[] {
  const { tuning, frets, bpm } = options;
  const slotSeconds = 60 / bpm / SLOTS_PER_BEAT;
  const lowest = tuning[0];
  const highest = tuning[tuning.length - 1] + frets;

  // Put the grid origin on a beat at or before the first note.
  const firstStart = Math.min(...notes.map((n) => n.start));
  const beatSeconds = slotSeconds * SLOTS_PER_BEAT;
  const origin = options.offset - Math.ceil((options.offset - firstStart - slotSeconds / 2) / beatSeconds) * beatSeconds;

  const bySlot = new Map<number, Chord>();
  for (const note of notes) {
    const slot = Math.max(0, Math.round((note.start - origin) / slotSeconds));
    const endSlot = Math.max(slot + 1, Math.round((note.start + note.duration - origin) / slotSeconds));
    const pitch = foldIntoRange(note.pitch, lowest, highest);
    const chord = bySlot.get(slot) ?? { slot, endSlot, pitches: [] };
    chord.endSlot = Math.max(chord.endSlot, endSlot);
    const existing = chord.pitches.find((p) => p.pitch === pitch);
    if (existing) existing.velocity = Math.max(existing.velocity, note.velocity);
    else chord.pitches.push({ pitch, velocity: note.velocity });
    bySlot.set(slot, chord);
  }

  // Start at the first bar that contains a note.
  const chords = [...bySlot.values()].sort((a, b) => a.slot - b.slot);
  const shift = Math.floor(chords[0].slot / SLOTS_PER_BAR) * SLOTS_PER_BAR;
  return chords.map((c) => ({ ...c, slot: c.slot - shift, endSlot: c.endSlot - shift }));
}

/** All ways to play a set of pitches on distinct strings, cheapest first. */
function fingerings(pitches: number[], tuning: number[], frets: number): Fingering[] {
  const results: PlacedNote[][] = [];
  const sorted = [...pitches].sort((a, b) => b - a);
  const assign = (i: number, used: Set<number>, acc: PlacedNote[]) => {
    if (results.length >= 500) return;
    if (i === sorted.length) {
      results.push([...acc]);
      return;
    }
    for (let string = 0; string < tuning.length; string++) {
      const fret = sorted[i] - tuning[string];
      if (used.has(string) || fret < 0 || fret > frets) continue;
      used.add(string);
      acc.push({ string, fret, pitch: sorted[i], tied: false });
      assign(i + 1, used, acc);
      acc.pop();
      used.delete(string);
    }
  };
  assign(0, new Set(), []);

  return results
    .map((notes) => {
      const fretted = notes.filter((n) => n.fret > 0).map((n) => n.fret);
      const position = fretted.length > 0 ? Math.min(...fretted) : null;
      const span = fretted.length > 0 ? Math.max(...fretted) - Math.min(...fretted) : 0;
      const averageFret = notes.reduce((s, n) => s + n.fret, 0) / notes.length;
      const highestFret = Math.max(...notes.map((n) => n.fret));
      // Stretches beyond 4 frets are barely playable; otherwise prefer compact shapes low on the neck,
      // and avoid the top of the neck unless nothing else works.
      const cost = (span > 4 ? 10 + span * 2 : span * 0.5) + averageFret * 0.15 + Math.max(0, highestFret - 12) * 0.5;
      return { notes: notes.sort((a, b) => a.string - b.string), cost, position };
    })
    .sort((a, b) => a.cost - b.cost)
    .slice(0, MAX_CANDIDATES);
}

/** Fingering candidates for a chord, dropping its quietest notes until it becomes playable. */
function chordCandidates(chord: Chord, tuning: number[], frets: number): { candidates: Fingering[]; dropped: number } {
  const pitches = [...chord.pitches].sort((a, b) => b.velocity - a.velocity).slice(0, tuning.length);
  let dropped = chord.pitches.length - pitches.length;
  while (pitches.length > 0) {
    const candidates = fingerings(pitches.map((p) => p.pitch), tuning, frets);
    if (candidates.length > 0) return { candidates, dropped };
    pitches.pop();
    dropped++;
  }
  return { candidates: [], dropped };
}

/**
 * Chooses one fingering per chord minimizing shape cost plus hand movement between chords,
 * with a Viterbi pass over the whole piece (O(chords × candidates²)).
 */
function chooseFingerings(candidateLists: Fingering[][]): Fingering[] {
  // The hand covers about four frets without shifting, so small moves are nearly free.
  const move = (a: Fingering, b: Fingering) => {
    if (a.position === null || b.position === null) return 0;
    const distance = Math.abs(a.position - b.position);
    return Math.max(0, distance - 3) * 0.8 + distance * 0.1;
  };

  const costs: number[][] = [];
  const back: number[][] = [];
  candidateLists.forEach((candidates, i) => {
    costs.push([]);
    back.push([]);
    candidates.forEach((candidate, j) => {
      if (i === 0) {
        costs[i][j] = candidate.cost;
        back[i][j] = -1;
        return;
      }
      let best = Infinity;
      let bestK = 0;
      candidateLists[i - 1].forEach((previous, k) => {
        const total = costs[i - 1][k] + move(previous, candidate);
        if (total < best) [best, bestK] = [total, k];
      });
      costs[i][j] = best + candidate.cost;
      back[i][j] = bestK;
    });
  });

  const chosen: Fingering[] = [];
  let j = costs[costs.length - 1].indexOf(Math.min(...costs[costs.length - 1]));
  for (let i = candidateLists.length - 1; i >= 0; i--) {
    chosen[i] = candidateLists[i][j];
    j = back[i][j];
  }
  return chosen;
}

/** Splits a span of slots into bar-aligned beats with standard note values. */
function splitIntoBeats(start: number, length: number, notes: PlacedNote[], out: Map<number, TabBeat[]>): void {
  let cursor = start;
  let first = true;
  while (cursor < start + length) {
    const bar = Math.floor(cursor / SLOTS_PER_BAR);
    const available = Math.min(start + length, (bar + 1) * SLOTS_PER_BAR) - cursor;
    const duration = DURATIONS.find((d) => d.slots <= available)!;
    const beatNotes = first ? notes : notes.map((n) => ({ ...n, tied: true }));
    const beats = out.get(bar) ?? [];
    beats.push({ notes: beatNotes, value: duration.value, dotted: duration.dotted });
    out.set(bar, beats);
    cursor += duration.slots;
    first = false;
  }
}

export function arrange(notes: NoteEvent[], options: ArrangeOptions): Arrangement {
  if (notes.length === 0) {
    return { bars: [[{ notes: [], value: 1, dotted: false }]], droppedNotes: 0 };
  }

  const chords = quantize(notes, options);
  let droppedNotes = 0;
  const playable: { chord: Chord; candidates: Fingering[] }[] = [];
  for (const chord of chords) {
    const { candidates, dropped } = chordCandidates(chord, options.tuning, options.frets);
    droppedNotes += dropped;
    if (candidates.length > 0) playable.push({ chord, candidates });
  }
  const chosen = chooseFingerings(playable.map((p) => p.candidates));

  const beatsByBar = new Map<number, TabBeat[]>();
  let cursor = 0;
  playable.forEach(({ chord }, i) => {
    if (chord.slot > cursor) splitIntoBeats(cursor, chord.slot - cursor, [], beatsByBar); // rest
    const nextSlot = playable[i + 1]?.chord.slot ?? Infinity;
    const end = Math.min(chord.endSlot, nextSlot);
    splitIntoBeats(chord.slot, end - chord.slot, chosen[i].notes, beatsByBar);
    cursor = end;
  });
  // Pad the last bar with rests.
  const totalSlots = Math.ceil(cursor / SLOTS_PER_BAR) * SLOTS_PER_BAR;
  if (totalSlots > cursor) splitIntoBeats(cursor, totalSlots - cursor, [], beatsByBar);

  const barCount = totalSlots / SLOTS_PER_BAR;
  const bars = Array.from({ length: barCount }, (_, i) => beatsByBar.get(i) ?? [{ notes: [], value: 1 as const, dotted: false }]);
  return { bars, droppedNotes };
}
