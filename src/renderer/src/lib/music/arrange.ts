// Turns detected notes (real time) into a playable tablature arrangement:
// quantize to a rhythmic grid → group into chords → pick strings/frets → split into bars.
import type { NoteEvent } from '../../../../shared/ipc';
import type { Tuning } from '../../../../shared/instruments';
import { METERS, type Meter, type MeterId } from '../../../../shared/meters';
import { gridOrigin } from './theory';

/** Durations are counted in ticks: 12 per quarter note, so both 16th notes (3) and triplets (4) are whole numbers. */
export const TICKS_PER_QUARTER = 12;

export interface PlacedNote {
  /** String index in the tuning's physical order (see Tuning.strings). */
  string: number;
  /** Fret, relative to the capo. */
  fret: number;
  pitch: number;
  /** Continuation of the same note from the previous beat (a tie). */
  tied: boolean;
  /** Indices of the detected notes (in the input array) this note was made from. */
  sources: number[];
}

export type NoteValue = 1 | 2 | 4 | 8 | 16;

export interface TabBeat {
  /** Empty for a rest. */
  notes: PlacedNote[];
  value: NoteValue;
  dotted: boolean;
  /** Part of a triplet (three of these fill the time of two). */
  tuplet: boolean;
}

export interface Arrangement {
  bars: TabBeat[][];
  meter: Meter;
  /** Notes that could not be placed (e.g. more simultaneous notes than strings). */
  droppedNotes: number;
  /** Total fingering difficulty; lower is easier. Used to detect a capo or tuning. */
  cost: number;
  /** Time in the recording, in seconds, where bar 1 starts. */
  startTime: number;
  /** Length of one tick in seconds (the score runs at a constant tempo). */
  tickSeconds: number;
}

export interface ArrangeOptions {
  /** Open-string MIDI pitches without capo, in the tuning's physical order. */
  tuning: number[];
  frets: number;
  /** Beats per minute, counting the meter's beat (a dotted quarter in 6/8). */
  bpm: number;
  /** Time in seconds of a beat; aligns the grid with the music. */
  offset: number;
  /** Capo fret (0 = none). Frets in the result are relative to it. */
  capo?: number;
  meter?: MeterId;
  /** Which beat (0-based, counted from the beat at or before the first note) is a downbeat. */
  barPhase?: number;
}

interface ChordPitch {
  pitch: number;
  velocity: number;
  sources: number[];
  /** String requested by the user for this note, if any. */
  hint?: number;
}

interface Chord {
  slot: number;
  endSlot: number;
  pitches: ChordPitch[];
}

interface Fingering {
  notes: PlacedNote[];
  cost: number;
  /** Lowest fretted position, or null when only open strings are played (the hand can move freely). */
  position: number | null;
}

// Written durations, longest first. Triplet values only appear in meters with a triplet feel.
const DURATIONS: { ticks: number; value: NoteValue; dotted: boolean; tuplet: boolean }[] = [
  { ticks: 48, value: 1, dotted: false, tuplet: false },
  { ticks: 36, value: 2, dotted: true, tuplet: false },
  { ticks: 24, value: 2, dotted: false, tuplet: false },
  { ticks: 18, value: 4, dotted: true, tuplet: false },
  { ticks: 12, value: 4, dotted: false, tuplet: false },
  { ticks: 9, value: 8, dotted: true, tuplet: false },
  { ticks: 8, value: 4, dotted: false, tuplet: true },
  { ticks: 6, value: 8, dotted: false, tuplet: false },
  { ticks: 4, value: 8, dotted: false, tuplet: true },
  { ticks: 3, value: 16, dotted: false, tuplet: false },
];

const MAX_CANDIDATES = 12;
/** Fingering cost charged for each note that had to be left out. */
const DROPPED_NOTE_COST = 5;

export function meterTicks(meter: Meter) {
  const beat = TICKS_PER_QUARTER * meter.quartersPerBeat;
  return { beat, slot: beat / meter.slotsPerBeat, bar: beat * meter.beatsPerBar };
}

/** Moves a pitch by octaves into the instrument's playable range. */
function foldIntoRange(pitch: number, lowest: number, highest: number): number {
  while (pitch < lowest) pitch += 12;
  while (pitch > highest) pitch -= 12;
  return pitch;
}

interface Grid {
  chords: Chord[];
  /** Recording time of slot 0 (the start of bar 1). */
  startTime: number;
  slotSeconds: number;
}

function quantize(notes: NoteEvent[], options: ArrangeOptions, meter: Meter, lowest: number, highest: number): Grid {
  const beatSeconds = 60 / options.bpm;
  const slotSeconds = beatSeconds / meter.slotsPerBeat;
  const slotsPerBar = meter.slotsPerBeat * meter.beatsPerBar;

  // Put the grid origin on a beat at or before the first note.
  const firstStart = Math.min(...notes.map((n) => n.start));
  const origin = gridOrigin(firstStart, options.offset, beatSeconds);
  // Bars start on the chosen downbeat; a pickup before it gets a bar of its own.
  const phaseSlots = ((options.barPhase ?? 0) % meter.beatsPerBar) * meter.slotsPerBeat;
  const barOrigin = phaseSlots === 0 ? 0 : phaseSlots - slotsPerBar;

  const bySlot = new Map<number, Chord>();
  notes.forEach((note, index) => {
    const slot = Math.max(0, Math.round((note.start - origin) / slotSeconds)) - barOrigin;
    const endSlot = Math.max(slot + 1, Math.round((note.start + note.duration - origin) / slotSeconds) - barOrigin);
    const pitch = foldIntoRange(note.pitch, lowest, highest);
    const chord = bySlot.get(slot) ?? { slot, endSlot, pitches: [] };
    chord.endSlot = Math.max(chord.endSlot, endSlot);
    const existing = chord.pitches.find((p) => p.pitch === pitch);
    if (existing) {
      existing.velocity = Math.max(existing.velocity, note.velocity);
      existing.sources.push(index);
      existing.hint ??= note.string;
    } else {
      chord.pitches.push({ pitch, velocity: note.velocity, sources: [index], hint: note.string });
    }
    bySlot.set(slot, chord);
  });

  // Start at the first bar that contains a note.
  const chords = [...bySlot.values()].sort((a, b) => a.slot - b.slot);
  const shift = Math.floor(chords[0].slot / slotsPerBar) * slotsPerBar;
  return {
    chords: chords.map((c) => ({ ...c, slot: c.slot - shift, endSlot: c.endSlot - shift })),
    startTime: origin + (barOrigin + shift) * slotSeconds,
    slotSeconds,
  };
}

/** All ways to play a set of pitches on distinct strings, cheapest first. */
function fingerings(pitches: ChordPitch[], tuning: number[], frets: number): Fingering[] {
  const results: PlacedNote[][] = [];
  const sorted = [...pitches].sort((a, b) => b.pitch - a.pitch);
  const assign = (i: number, used: Set<number>, acc: PlacedNote[]) => {
    if (results.length >= 500) return;
    if (i === sorted.length) {
      results.push([...acc]);
      return;
    }
    const { pitch, hint, sources } = sorted[i];
    // A string chosen by the user wins whenever that string can play the note.
    const hinted = hint !== undefined && hint < tuning.length && pitch - tuning[hint] >= 0 && pitch - tuning[hint] <= frets;
    for (let string = 0; string < tuning.length; string++) {
      if (hinted && string !== hint) continue;
      const fret = pitch - tuning[string];
      if (used.has(string) || fret < 0 || fret > frets) continue;
      used.add(string);
      acc.push({ string, fret, pitch, tied: false, sources });
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
    const candidates = fingerings(pitches, tuning, frets);
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
  // The hand covers about four frets without shifting, so small moves are nearly free. Open strings
  // leave the hand where it was, but give it time to move: shifts across them cost half.
  const move = (from: number | null, to: Fingering, acrossOpen: boolean) => {
    if (from === null || to.position === null) return 0;
    const distance = Math.abs(from - to.position);
    return (Math.max(0, distance - 3) * 0.8 + distance * 0.1) * (acrossOpen ? 0.5 : 1);
  };

  const costs: number[][] = [];
  const back: number[][] = [];
  // Where the hand is after each candidate (the last fretted position on the best path to it), and
  // whether only open strings were played since.
  const hand: (number | null)[][] = [];
  const open: boolean[][] = [];
  candidateLists.forEach((candidates, i) => {
    costs.push([]);
    back.push([]);
    hand.push([]);
    open.push([]);
    candidates.forEach((candidate, j) => {
      if (i === 0) {
        costs[i][j] = candidate.cost;
        back[i][j] = -1;
        hand[i][j] = candidate.position;
        open[i][j] = candidate.position === null;
        return;
      }
      let best = Infinity;
      let bestK = 0;
      candidateLists[i - 1].forEach((_, k) => {
        const total = costs[i - 1][k] + move(hand[i - 1][k], candidate, open[i - 1][k]);
        if (total < best) [best, bestK] = [total, k];
      });
      costs[i][j] = best + candidate.cost;
      back[i][j] = bestK;
      hand[i][j] = candidate.position ?? hand[i - 1][bestK];
      open[i][j] = candidate.position === null;
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

/**
 * Splits a span of ticks into written beats. Notes starting on a beat may last whole beats; anything
 * else stays within its beat, so rhythms are written beat by beat as musicians read them.
 */
function splitIntoBeats(start: number, length: number, notes: PlacedNote[], meter: Meter, out: Map<number, TabBeat[]>): void {
  const ticks = meterTicks(meter);
  const allowed = DURATIONS.filter((d) => (meter.tuplets ? d.tuplet || d.ticks % ticks.beat === 0 : !d.tuplet && d.ticks % ticks.slot === 0));
  let cursor = start;
  let first = true;
  while (cursor < start + length) {
    const bar = Math.floor(cursor / ticks.bar);
    const end = Math.min(start + length, (bar + 1) * ticks.bar);
    const beatStart = cursor % ticks.beat === 0;
    const nextBeat = (Math.floor(cursor / ticks.beat) + 1) * ticks.beat;
    const duration = allowed.find((d) =>
      beatStart
        ? d.ticks <= end - cursor && (d.ticks % ticks.beat === 0 || d.ticks < ticks.beat)
        : d.ticks <= Math.min(end, nextBeat) - cursor,
    )!;
    const beatNotes = first ? notes : notes.map((n) => ({ ...n, tied: true }));
    const beats = out.get(bar) ?? [];
    beats.push({ notes: beatNotes, value: duration.value, dotted: duration.dotted, tuplet: duration.tuplet });
    out.set(bar, beats);
    cursor += duration.ticks;
    first = false;
  }
}

export function arrange(notes: NoteEvent[], options: ArrangeOptions): Arrangement {
  const meter = METERS[options.meter ?? '4/4'];
  const ticks = meterTicks(meter);
  const wholeBar = (): TabBeat[] => {
    const out = new Map<number, TabBeat[]>();
    splitIntoBeats(0, ticks.bar, [], meter, out);
    return out.get(0)!;
  };
  const tickSeconds = 60 / options.bpm / ticks.beat;
  if (notes.length === 0) {
    return { bars: [wholeBar()], meter, droppedNotes: 0, cost: 0, startTime: 0, tickSeconds };
  }

  const capo = options.capo ?? 0;
  const tuning = options.tuning.map((pitch) => pitch + capo);
  const frets = options.frets - capo;
  // Not tuning[0] / tuning.at(-1): re-entrant tunings (ukulele) are not in pitch order.
  const grid = quantize(notes, options, meter, Math.min(...tuning), Math.max(...tuning) + frets);

  let droppedNotes = 0;
  const playable: { chord: Chord; candidates: Fingering[] }[] = [];
  for (const chord of grid.chords) {
    const { candidates, dropped } = chordCandidates(chord, tuning, frets);
    droppedNotes += dropped;
    if (candidates.length > 0) playable.push({ chord, candidates });
  }
  const { chosen, cost } = chooseFingerings(playable.map((p) => p.candidates));

  // Each chord lasts until it ends or the next one starts; gaps become rests.
  const beatsByBar = new Map<number, TabBeat[]>();
  let cursor = 0;
  playable.forEach(({ chord }, i) => {
    const start = chord.slot * ticks.slot;
    if (start > cursor) splitIntoBeats(cursor, start - cursor, [], meter, beatsByBar);
    const end = Math.min(chord.endSlot, playable[i + 1]?.chord.slot ?? Infinity) * ticks.slot;
    splitIntoBeats(start, end - start, chosen[i].notes, meter, beatsByBar);
    cursor = end;
  });
  // Pad the last bar with rests.
  const totalTicks = Math.max(ticks.bar, Math.ceil(cursor / ticks.bar) * ticks.bar);
  if (totalTicks > cursor) splitIntoBeats(cursor, totalTicks - cursor, [], meter, beatsByBar);

  const bars = Array.from({ length: totalTicks / ticks.bar }, (_, i) => beatsByBar.get(i) ?? wholeBar());
  return {
    bars,
    meter,
    droppedNotes,
    cost: cost + droppedNotes * DROPPED_NOTE_COST,
    startTime: grid.startTime,
    tickSeconds: grid.slotSeconds / ticks.slot,
  };
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

type FingeringOptions = Omit<ArrangeOptions, 'capo' | 'meter' | 'barPhase'>;

/**
 * Suggests a capo position. A capo is used to play open chord shapes in another key, so it is only
 * considered for chordal parts that reach down to the capoed low strings, and only where (almost) no
 * note is lower than the capoed lowest string. Among those positions it picks the one whose
 * fingerings are clearly easier.
 */
export function detectCapo(notes: NoteEvent[], options: FingeringOptions, maxCapo: number): number {
  // Melodies and riffs: open strings high up the neck would look "easier", but that is not a capo.
  if (notes.length === 0 || chordShare(notes) < 0.3) return 0;
  const [lowestString, secondLowestString] = [...options.tuning].sort((a, b) => a - b);
  const lowestNote = Math.min(...notes.map((n) => n.pitch));
  const baseline = arrange(notes, { ...options, capo: 0 }).cost;
  let best = { capo: 0, cost: baseline };
  for (let capo = 1; capo <= maxCapo; capo++) {
    const tooLow = notes.filter((n) => n.pitch < lowestString + capo).length;
    // A few stray low notes (noise, harmonics) are tolerated; more means no capo this high.
    if (tooLow > notes.length * 0.02) break;
    // Open-shape chords with a capo have their bass on the capoed low strings.
    if (lowestNote > secondLowestString + capo) continue;
    const { cost } = arrange(notes, { ...options, capo });
    if (cost < best.cost) best = { capo, cost };
  }
  // Only suggest a capo when it makes the part clearly easier.
  return best.cost < baseline * 0.8 ? best.capo : 0;
}

/**
 * Picks the most likely tuning among the instrument's common ones (the first is the default).
 * A tuning is ruled out when more than 2% of the notes are below its lowest string — that is how a
 * drop D, a 5-string bass or a low-G ukulele shows up. Otherwise another tuning must make the
 * fingerings clearly easier than the default, as with songs played tuned half a step down.
 */
export function detectTuning(notes: NoteEvent[], tunings: Tuning[], options: Omit<FingeringOptions, 'tuning'>): Tuning {
  const candidates = tunings.filter((t) => t.autoDetect !== false);
  const [standard] = candidates;
  if (notes.length === 0) return standard;

  const evaluate = (tuning: Tuning) => {
    const lowest = Math.min(...tuning.strings);
    const tooLow = notes.filter((n) => n.pitch < lowest).length / notes.length;
    return { tuning, playable: tooLow <= 0.02, cost: arrange(notes, { ...options, tuning: tuning.strings }).cost };
  };
  const results = candidates.map(evaluate);
  const baseline = results[0];
  const playable = results.filter((r) => r.playable).sort((a, b) => a.cost - b.cost);
  if (!baseline.playable) return playable[0]?.tuning ?? standard;
  const best = playable[0];
  return best.cost < baseline.cost * 0.8 ? best.tuning : standard;
}
