import type { NoteEvent } from '../../../../shared/ipc';

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
  return { tonic, mode, name: `${name} ${mode}`, alphaTex: mode === 'major' ? ascii : `${ascii}minor` };
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

/**
 * Estimates the tempo by testing how well note onsets line up with a grid of each candidate period
 * and its subdivisions (phase-invariant: the magnitude of the onsets' mean phase vector), weighted by
 * a prior around 110 BPM to break ties between a tempo and its double. Half/double-tempo mistakes
 * remain possible, which is why the UI lets the user halve, double or type the tempo.
 */
export function estimateTempo(notes: NoteEvent[]): TempoEstimate {
  // Merge near-simultaneous onsets (chords) into one weighted onset.
  const onsets: { time: number; weight: number }[] = [];
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const last = onsets[onsets.length - 1];
    if (last && note.start - last.time < 0.03) last.weight += note.velocity;
    else onsets.push({ time: note.start, weight: note.velocity });
  }
  if (onsets.length < 4) return { bpm: 120, offset: onsets[0]?.time ?? 0 };

  const totalWeight = onsets.reduce((s, o) => s + o.weight, 0);
  const alignment = (period: number) => {
    let re = 0;
    let im = 0;
    for (const { time, weight } of onsets) {
      const angle = (2 * Math.PI * time) / period;
      re += weight * Math.cos(angle);
      im += weight * Math.sin(angle);
    }
    return { magnitude: Math.hypot(re, im) / totalWeight, phase: Math.atan2(im, re) };
  };
  const score = (bpm: number) => {
    const period = 60 / bpm;
    // Listeners tend to hear the beat around 110 BPM (log-normal prior, σ = half an octave).
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.5) ** 2);
    const fit = alignment(period).magnitude + 0.5 * alignment(period / 2).magnitude + 0.25 * alignment(period / 4).magnitude;
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
  const phase = alignment(period).phase;
  const offset = ((((phase / (2 * Math.PI)) * period) % period) + period) % period;
  return { bpm, offset };
}
