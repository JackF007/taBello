import type { NoteEvent } from '../../../../shared/ipc';
import type { MeterId } from '../../../../shared/meters';
import { anchorBeat, beatGrid, constantGrid } from './tempo';

const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/** alphaTex pitch name, e.g. 64 → "e4" (scientific pitch notation, middle C = c4). */
export function alphaTexPitch(midi: number): string {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: 'major' | 'minor';
  /** Display name, e.g. "E minor". */
  name: string;
  /** alphaTex key signature argument, e.g. "eminor". */
  alphaTex: string;
  /** Whether the key signature uses flats, so chord names should too. */
  flats: boolean;
}

// Conventional spellings: the ones with the fewest accidentals in their key signature.
const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

// Krumhansl–Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]): number {
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export function makeKey(tonic: number, mode: 'major' | 'minor'): Key {
  const name = (mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[tonic];
  const ascii = name.replace('♭', 'b').replace('♯', '#').toLowerCase();
  // Sharps in the key signature, by going around the circle of fifths (from the relative major).
  const sharps = (((mode === 'major' ? tonic : tonic + 3) % 12) * 7) % 12;
  return { tonic, mode, name: `${name} ${mode}`, alphaTex: mode === 'major' ? ascii : `${ascii}minor`, flats: sharps > 6 };
}

/** Krumhansl–Schmuckler key finding over a duration- and loudness-weighted pitch-class histogram. */
export function detectKey(notes: NoteEvent[]): Key {
  const histogram = new Array<number>(12).fill(0);
  for (const note of notes) histogram[note.pitch % 12] += note.duration * note.velocity;

  let best = makeKey(0, 'major');
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = histogram.map((_, i) => histogram[(i + tonic) % 12]);
    for (const mode of ['major', 'minor'] as const) {
      const score = correlation(rotated, mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE);
      if (score > bestScore) {
        bestScore = score;
        best = makeKey(tonic, mode);
      }
    }
  }
  return best;
}

export interface TempoEstimate {
  bpm: number;
  /** Time in seconds of a beat, used to align the quantization grid. */
  offset: number;
}

const MIN_BPM = 60;
const MAX_BPM = 180;

interface Onset {
  time: number;
  /** Sum of the velocities. */
  weight: number;
  notes: NoteEvent[];
}

/** Groups near-simultaneous onsets (chords) into one weighted onset. */
function mergeOnsets(notes: NoteEvent[]): Onset[] {
  const onsets: Onset[] = [];
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const last = onsets[onsets.length - 1];
    if (last && note.start - last.time < 0.03) {
      last.weight += note.velocity;
      last.notes.push(note);
    } else onsets.push({ time: note.start, weight: note.velocity, notes: [note] });
  }
  return onsets;
}

/** How consistently onsets fall on a grid of this period (0..1), and the grid's phase. */
function alignment(onsets: Onset[], period: number): { magnitude: number; phase: number } {
  let re = 0;
  let im = 0;
  let total = 0;
  for (const { time, weight } of onsets) {
    const angle = (2 * Math.PI * time) / period;
    re += weight * Math.cos(angle);
    im += weight * Math.sin(angle);
    total += weight;
  }
  return { magnitude: total === 0 ? 0 : Math.hypot(re, im) / total, phase: Math.atan2(im, re) };
}

/**
 * Estimates the tempo by testing how well note onsets line up with a grid of each candidate period
 * and its subdivisions (phase-invariant: the magnitude of the onsets' mean phase vector), weighted by
 * a prior around 110 BPM to break ties between a tempo and its double. Half/double-tempo mistakes
 * remain possible, which is why the UI lets the user halve, double or type the tempo.
 */
export function estimateTempo(notes: NoteEvent[]): TempoEstimate {
  const onsets = mergeOnsets(notes);
  if (onsets.length < 4) return { bpm: 120, offset: onsets[0]?.time ?? 0 };

  const score = (bpm: number) => {
    const period = 60 / bpm;
    // Listeners tend to hear the beat around 110 BPM (log-normal prior, σ = half an octave).
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.5) ** 2);
    const fit =
      alignment(onsets, period).magnitude + 0.5 * alignment(onsets, period / 2).magnitude + 0.25 * alignment(onsets, period / 4).magnitude;
    return fit * prior;
  };

  let bestBpm = 120;
  let bestScore = -Infinity;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const s = score(bpm);
    if (s > bestScore) [bestBpm, bestScore] = [bpm, s];
  }
  // Refine around the coarse maximum.
  for (let bpm = bestBpm - 0.5; bpm <= bestBpm + 0.5; bpm += 0.05) {
    const s = score(bpm);
    if (s > bestScore) [bestBpm, bestScore] = [bpm, s];
  }

  const bpm = Math.round(bestBpm * 10) / 10;
  const period = 60 / bpm;
  const phase = alignment(onsets, period).phase;
  const offset = ((((phase / (2 * Math.PI)) * period) % period) + period) % period;
  return { bpm, offset };
}

/** Like alignment(), on a grid that may change tempo: how well onsets fit `divisions` per beat. */
function alignmentOnGrid(onsets: Onset[], toBeat: (t: number) => number, divisions: number): { magnitude: number; phase: number } {
  let re = 0;
  let im = 0;
  let total = 0;
  for (const { time, weight } of onsets) {
    const angle = 2 * Math.PI * divisions * toBeat(time);
    re += weight * Math.cos(angle);
    im += weight * Math.sin(angle);
    total += weight;
  }
  return { magnitude: total === 0 ? 0 : Math.hypot(re, im) / total, phase: Math.atan2(im, re) };
}

export interface MeterEstimate {
  meter: MeterId;
  /** Which beat (0-based from the beat at or before the first note) is a downbeat. */
  barPhase: number;
  /** Beat offset refined on the subdivision grid (off-beat notes can pull the tempo's offset). */
  offset: number;
}

/**
 * Guesses the meter from the notes, conservatively (4/4 unless the evidence is clear):
 * - triplet feel when the notes fit a grid of beat thirds (swing, shuffle) and not one of quarters;
 * - 3/4 when accents (loud onsets, bass notes) repeat every three beats rather than every four.
 * It also returns where the downbeats are, so bar lines fall on the accents.
 */
export function detectMeter(notes: NoteEvent[], tempo: TempoEstimate, beatTimes?: number[]): MeterEstimate {
  const onsets = mergeOnsets(notes);
  const fallback: MeterEstimate = { meter: '4/4', barPhase: 0, offset: tempo.offset };
  if (onsets.length < 12) return fallback;
  const period = 60 / tempo.bpm;

  const tracked = beatTimes && beatTimes.length >= 2 ? beatGrid(beatTimes) : null;

  // Subdivision: a straight grid (8ths, 16ths) and a triplet grid cannot both fit off-beat notes.
  const thirds = tracked ? alignmentOnGrid(onsets, tracked.toBeat, 3) : alignment(onsets, period / 3);
  const quarters = tracked ? alignmentOnGrid(onsets, tracked.toBeat, 4) : alignment(onsets, period / 4);
  const triplets = thirds.magnitude > 0.75 && thirds.magnitude > quarters.magnitude + 0.25;

  // Refine the beat offset: the subdivision grid position closest to the estimated beat.
  const sub = triplets ? period / 3 : period / 4;
  const subOffset = (((((triplets ? thirds : quarters).phase / (2 * Math.PI)) * sub) % sub) + sub) % sub;
  let offset = tempo.offset;
  let bestDistance = Infinity;
  for (let k = 0; !tracked && k * sub < period; k++) {
    const candidate = subOffset + k * sub;
    const d = Math.abs(candidate - tempo.offset);
    const distance = Math.min(d, period - d);
    if (distance < bestDistance) [offset, bestDistance] = [candidate, distance];
  }

  // Accent per beat: the loudest note, plus a bonus for a note in the low register (bass notes mark
  // downbeats, as in "oom-pah-pah"). Simultaneous strummed notes do not add up: they are one stroke.
  const bassOf = (onset: Onset) => Math.min(...onset.notes.map((n) => n.pitch));
  const basses = onsets.map(bassOf).sort((x, y) => x - y);
  const lowRegister = Math.min(basses[Math.floor(basses.length * 0.2)], basses[Math.floor(basses.length / 2)] - 1);
  const grid = tracked ?? constantGrid(tempo.bpm, offset);
  const origin = anchorBeat(grid, onsets[0].time);
  const strength = new Map<number, number>();
  for (const onset of onsets) {
    const position = grid.toBeat(onset.time) - origin;
    const beat = Math.round(position);
    if (Math.abs(position - beat) > 0.15) continue;
    const accent = Math.max(...onset.notes.map((n) => n.velocity)) + (bassOf(onset) <= lowRegister ? 1 : 0);
    strength.set(beat, Math.max(strength.get(beat) ?? 0, accent));
  }
  const beats = Array.from({ length: Math.max(...strength.keys()) + 1 }, (_, i) => strength.get(i) ?? 0);
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const average = mean(beats);
  const straight: MeterEstimate = { meter: triplets ? '4/4-triplets' : '4/4', barPhase: 0, offset };
  if (beats.length < 12 || average === 0) return straight;

  // For each grouping, the best downbeat position and how much stronger those beats are than average.
  const accent = (beatsPerBar: number) => {
    let best = { phase: 0, ratio: 0 };
    for (let phase = 0; phase < beatsPerBar; phase++) {
      const ratio = mean(beats.filter((_, i) => i % beatsPerBar === phase)) / average;
      if (ratio > best.ratio) best = { phase, ratio };
    }
    return best;
  };
  const three = accent(3);
  const four = accent(4);
  if (!triplets && three.ratio > 1.3 && three.ratio > four.ratio * 1.15) return { meter: '3/4', barPhase: three.phase, offset };
  return { ...straight, barPhase: four.ratio > 1.2 ? four.phase : 0 };
}

const CHORD_TYPES: [suffix: string, intervals: number[]][] = [
  ['', [0, 4, 7]],
  ['m', [0, 3, 7]],
  ['7', [0, 4, 7, 10]],
  ['maj7', [0, 4, 7, 11]],
  ['m7', [0, 3, 7, 10]],
  ['6', [0, 4, 7, 9]],
  ['m6', [0, 3, 7, 9]],
  ['sus4', [0, 5, 7]],
  ['sus2', [0, 2, 7]],
  ['add9', [0, 2, 4, 7]],
  ['dim', [0, 3, 6]],
  ['aug', [0, 4, 8]],
  ['5', [0, 7]],
];
const SHARP_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Names the chord formed by some pitches (e.g. "Am", "G7", "C/G"), or null when they do not form a
 * recognizable chord. Every note must belong to the chord; the fifth may be missing.
 */
export function chordName(pitches: number[], flats = false): string | null {
  const classes = new Set(pitches.map((p) => ((p % 12) + 12) % 12));
  if (classes.size < 2) return null;
  const bass = ((Math.min(...pitches) % 12) + 12) % 12;
  const roots = flats ? FLAT_ROOTS : SHARP_ROOTS;

  let best: { name: string; score: number } | null = null;
  for (const root of classes) {
    CHORD_TYPES.forEach(([suffix, intervals], order) => {
      const tones = intervals.map((i) => (root + i) % 12);
      if ([...classes].some((c) => !tones.includes(c))) return;
      const missing = tones.filter((t) => !classes.has(t));
      const fifth = (root + 7) % 12;
      if (missing.some((t) => t !== fifth) || (missing.length > 0 && intervals.length < 3)) return;
      // Prefer complete chords, chords in root position, then the simpler chord types.
      const score = (missing.length === 0 ? 100 : 0) + (root === bass ? 50 : 0) - order;
      if (!best || score > best.score) {
        const name = roots[root] + suffix;
        best = { name: root === bass ? name : `${name}/${roots[bass]}`, score };
      }
    });
  }
  return best ? (best as { name: string }).name : null;
}
