// Turns detected notes (real time) into a written arrangement:
// quantize to a 16th-note grid → group into chords → place the notes
// (strings/frets for guitar and bass, staves for the other instruments) → split into 4/4 bars.
import type { NoteEvent } from '../../../../shared/ipc';

export const SLOTS_PER_BEAT = 4; // 16th notes
export const BEATS_PER_BAR = 4; // 4/4
export const SLOTS_PER_BAR = SLOTS_PER_BEAT * BEATS_PER_BAR;

export interface PlacedNote {
  pitch: number;
  /** Continuation of the same note from the previous beat (a tie). */
  tied: boolean;
  /** String index, 0 = lowest-pitched string (fretted instruments only). */
  string?: number;
  /** Fret, relative to the capo (fretted instruments only). */
  fret?: number;
}

export type NoteValue = 1 | 2 | 4 | 8 | 16;

export interface TabBeat {
  /** Empty for a rest. */
  notes: PlacedNote[];
  value: NoteValue;
  dotted: boolean;
}

export interface Arrangement {
  /** One entry per staff (a single staff, or treble + bass for a grand staff), each a list of bars. */
  staves: TabBeat[][][];
  /** Notes that could not be placed (more simultaneous notes than the instrument allows). */
  droppedNotes: number;
  /** Total fingering difficulty (fretted instruments); lower is easier. Used to detect a capo. */
  cost: number;
}

interface Timing {
  bpm: number;
  /** Time in seconds of a beat; aligns the grid with the music. */
  offset: number;
}

export interface FrettedOptions extends Timing {
  kind: 'fretted';
  /** Open-string MIDI pitches without capo, lowest string first. */
  tuning: number[];
  frets: number;
  /** Capo fret (0 = none). Frets in the result are relative to it. */
  capo?: number;
}

export interface PitchedOptions extends Timing {
  kind: 'pitched';
  range: [lowest: number, highest: number];
  maxPolyphony: number;
  /** When set, notes at or above this pitch go to the upper staff and the others to the lower one. */
  splitAt?: number;
}

export type ArrangeOptions = FrettedOptions | PitchedOptions;

interface Chord {
  slot: number;
  endSlot: number;
  pitches: { pitch: number; velocity: number }[];
}

interface PlacedChord {
  slot: number;
  endSlot: number;
  notes: PlacedNote[];
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
/** Fingering cost charged for each note that had to be left out. */
const DROPPED_NOTE_COST = 5;

/** Moves a pitch by octaves into the instrument's playable range. */
function foldIntoRange(pitch: number, lowest: number, highest: number): number {
  while (pitch < lowest) pitch += 12;
  while (pitch > highest) pitch -= 12;
  return pitch;
}

function quantize(notes: NoteEvent[], { bpm, offset }: Timing, lowest: number, highest: number): Chord[] {
  const slotSeconds = 60 / bpm / SLOTS_PER_BEAT;

  // Put the grid origin on a beat at or before the first note.
  const firstStart = Math.min(...notes.map((n) => n.start));
  const beatSeconds = slotSeconds * SLOTS_PER_BEAT;
  const origin = offset - Math.ceil((offset - firstStart - slotSeconds / 2) / beatSeconds) * beatSeconds;

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
      const fretList = notes.map((n) => n.fret!);
      const fretted = fretList.filter((f) => f > 0);
      const position = fretted.length > 0 ? Math.min(...fretted) : null;
      const span = fretted.length > 0 ? Math.max(...fretted) - Math.min(...fretted) : 0;
      const averageFret = fretList.reduce((s, f) => s + f, 0) / notes.length;
      const highestFret = Math.max(...fretList);
      // Stretches beyond 4 frets are barely playable; otherwise prefer compact shapes low on the neck,
      // and avoid the top of the neck unless nothing else works.
      const cost = (span > 4 ? 10 + span * 2 : span * 0.5) + averageFret * 0.15 + Math.max(0, highestFret - 12) * 0.5;
      return { notes: notes.sort((a, b) => a.string! - b.string!), cost, position };
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
function chooseFingerings(candidateLists: Fingering[][]): { chosen: Fingering[]; cost: number } {
  if (candidateLists.length === 0) return { chosen: [], cost: 0 };
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

  const last = costs[costs.length - 1];
  const cost = Math.min(...last);
  const chosen: Fingering[] = [];
  let j = last.indexOf(cost);
  for (let i = candidateLists.length - 1; i >= 0; i--) {
    chosen[i] = candidateLists[i][j];
    j = back[i][j];
  }
  return { chosen, cost };
}

function placeFretted(notes: NoteEvent[], options: FrettedOptions): { chords: PlacedChord[]; dropped: number; cost: number } {
  const capo = options.capo ?? 0;
  const tuning = options.tuning.map((pitch) => pitch + capo);
  const frets = options.frets - capo;
  const chords = quantize(notes, options, tuning[0], tuning[tuning.length - 1] + frets);

  let dropped = 0;
  const playable: { chord: Chord; candidates: Fingering[] }[] = [];
  for (const chord of chords) {
    const result = chordCandidates(chord, tuning, frets);
    dropped += result.dropped;
    if (result.candidates.length > 0) playable.push({ chord, candidates: result.candidates });
  }
  const { chosen, cost } = chooseFingerings(playable.map((p) => p.candidates));
  return {
    chords: playable.map(({ chord }, i) => ({ slot: chord.slot, endSlot: chord.endSlot, notes: chosen[i].notes })),
    dropped,
    cost: cost + dropped * DROPPED_NOTE_COST,
  };
}

function placePitched(notes: NoteEvent[], options: PitchedOptions): { staves: PlacedChord[][]; dropped: number } {
  const chords = quantize(notes, options, ...options.range);
  const staves: PlacedChord[][] = options.splitAt === undefined ? [[]] : [[], []];
  let dropped = 0;
  for (const chord of chords) {
    const kept = [...chord.pitches].sort((a, b) => b.velocity - a.velocity).slice(0, options.maxPolyphony);
    dropped += chord.pitches.length - kept.length;
    const placed = kept.map((p) => ({ pitch: p.pitch, tied: false })).sort((a, b) => a.pitch - b.pitch);
    const parts = options.splitAt === undefined ? [placed] : [placed.filter((n) => n.pitch >= options.splitAt!), placed.filter((n) => n.pitch < options.splitAt!)];
    parts.forEach((part, staff) => {
      if (part.length > 0) staves[staff].push({ slot: chord.slot, endSlot: chord.endSlot, notes: part });
    });
  }
  return { staves, dropped };
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

/** Lays a staff's chords out on the timeline: each lasts until it ends or the next chord starts, gaps become rests. */
function toBeats(chords: PlacedChord[]): { beatsByBar: Map<number, TabBeat[]>; endSlot: number } {
  const beatsByBar = new Map<number, TabBeat[]>();
  let cursor = 0;
  chords.forEach((chord, i) => {
    if (chord.slot > cursor) splitIntoBeats(cursor, chord.slot - cursor, [], beatsByBar);
    const end = Math.min(chord.endSlot, chords[i + 1]?.slot ?? Infinity);
    splitIntoBeats(chord.slot, end - chord.slot, chord.notes, beatsByBar);
    cursor = end;
  });
  return { beatsByBar, endSlot: cursor };
}

export function arrange(notes: NoteEvent[], options: ArrangeOptions): Arrangement {
  const staffCount = options.kind === 'pitched' && options.splitAt !== undefined ? 2 : 1;
  const wholeRest = (): TabBeat[] => [{ notes: [], value: 1, dotted: false }];
  if (notes.length === 0) {
    return { staves: Array.from({ length: staffCount }, () => [wholeRest()]), droppedNotes: 0, cost: 0 };
  }

  let staffChords: PlacedChord[][];
  let droppedNotes: number;
  let cost = 0;
  if (options.kind === 'fretted') {
    const placed = placeFretted(notes, options);
    staffChords = [placed.chords];
    droppedNotes = placed.dropped;
    cost = placed.cost;
  } else {
    const placed = placePitched(notes, options);
    staffChords = placed.staves;
    droppedNotes = placed.dropped;
  }

  const laidOut = staffChords.map(toBeats);
  // All staves get the same number of bars, padded with rests.
  const barCount = Math.max(1, ...laidOut.map(({ endSlot }) => Math.ceil(endSlot / SLOTS_PER_BAR)));
  const staves = laidOut.map(({ beatsByBar, endSlot }) => {
    if (barCount * SLOTS_PER_BAR > endSlot) splitIntoBeats(endSlot, barCount * SLOTS_PER_BAR - endSlot, [], beatsByBar);
    return Array.from({ length: barCount }, (_, i) => beatsByBar.get(i) ?? wholeRest());
  });
  return { staves, droppedNotes, cost };
}

/** Share of onsets (notes starting within 50 ms of each other) that are chords of three notes or more. */
function chordShare(notes: NoteEvent[]): number {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const groups: number[] = [];
  let groupStart = -Infinity;
  for (const note of sorted) {
    if (note.start - groupStart < 0.05) groups[groups.length - 1]++;
    else {
      groups.push(1);
      groupStart = note.start;
    }
  }
  return groups.filter((size) => size >= 3).length / groups.length;
}

/**
 * Suggests a capo position for a fretted instrument. A capo is used to play open chord shapes in
 * another key, so it is only considered for chordal parts that reach down to the capoed low strings,
 * and only where (almost) no note is lower than the capoed lowest string. Among those positions it
 * picks the one whose fingerings are clearly easier.
 */
export function detectCapo(notes: NoteEvent[], options: Omit<FrettedOptions, 'capo'>, maxCapo: number): number {
  // Melodies and riffs: open strings high up the neck would look "easier", but that is not a capo.
  if (notes.length === 0 || chordShare(notes) < 0.3) return 0;
  const lowest = Math.min(...notes.map((n) => n.pitch));
  const baseline = arrange(notes, { ...options, capo: 0 }).cost;
  let best = { capo: 0, cost: baseline };
  for (let capo = 1; capo <= maxCapo; capo++) {
    const tooLow = notes.filter((n) => n.pitch < options.tuning[0] + capo).length;
    // A few stray low notes (noise, harmonics) are tolerated; more means no capo this high.
    if (tooLow > notes.length * 0.02) break;
    // Open-shape chords with a capo have their bass on the capoed low strings.
    if (lowest > options.tuning[1] + capo) continue;
    const { cost } = arrange(notes, { ...options, capo });
    if (cost < best.cost) best = { capo, cost };
  }
  // Only suggest a capo when it makes the part clearly easier.
  return best.cost < baseline * 0.8 ? best.capo : 0;
}
