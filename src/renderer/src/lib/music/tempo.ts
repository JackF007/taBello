// Time ↔ beat mapping, constant or following the tempo changes of a recording.
import type { NoteEvent } from '../../../../shared/ipc';

/** Converts recording time (seconds) to a beat position and back. */
export interface TimeGrid {
  toBeat(seconds: number): number;
  toTime(beat: number): number;
}

export function constantGrid(bpm: number, offset: number): TimeGrid {
  const period = 60 / bpm;
  return { toBeat: (t) => (t - offset) / period, toTime: (b) => offset + b * period };
}

/**
 * A grid through the given beat times (increasing, at least two), linear between beats and
 * continued at the first/last beat's tempo beyond them.
 */
export function beatGrid(beats: number[]): TimeGrid {
  const last = beats.length - 1;
  return {
    toBeat(t) {
      if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
      if (t >= beats[last]) return last + (t - beats[last]) / (beats[last] - beats[last - 1]);
      let lo = 0;
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] <= t) lo = mid;
        else hi = mid;
      }
      return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
    },
    toTime(b) {
      if (b <= 0) return beats[0] + b * (beats[1] - beats[0]);
      if (b >= last) return beats[last] + (b - last) * (beats[last] - beats[last - 1]);
      const i = Math.floor(b);
      return beats[i] + (b - i) * (beats[i + 1] - beats[i]);
    },
  };
}

/** Index of the beat at or just before a time: beat 0 of the score's grid for its first note. */
export function anchorBeat(grid: TimeGrid, firstStart: number): number {
  return Math.floor(grid.toBeat(firstStart) + 1 / 8);
}

const FPS = 100;

/**
 * Dynamic-programming beat tracker (D. Ellis, "Beat Tracking by Dynamic Programming", 2007): beats
 * fall on strong onsets while successive intervals stay close to the expected period, so the
 * tracker can follow a tempo that drifts or changes. Returns beat times in seconds.
 */
export function trackBeats(notes: NoteEvent[], bpm: number): number[] {
  if (notes.length === 0) return [];
  const end = Math.max(...notes.map((n) => n.start + n.duration)) + 1;
  const length = Math.ceil(end * FPS);
  const envelope = new Float64Array(length);
  // Onset strength: each note's loudness (picked notes count more than legato ones), spread ±20 ms.
  for (const note of notes) {
    const frame = Math.round(note.start * FPS);
    const weight = note.velocity * (note.attack === undefined ? 1 : 0.4 + 0.6 * note.attack);
    for (let d = -2; d <= 2; d++) if (frame + d >= 0 && frame + d < length) envelope[frame + d] += weight * Math.exp(-(d * d) / 2);
  }
  const mean = envelope.reduce((s, v) => s + v, 0) / length;
  const std = Math.sqrt(envelope.reduce((s, v) => s + (v - mean) ** 2, 0) / length) || 1;
  const local = Array.from(envelope, (v) => v / std);

  const period = (60 / bpm) * FPS;
  // Lower than Ellis's 100: note onsets make a sparse envelope, with fewer peaks to hold on to.
  const tightness = 20;
  const score = new Float64Array(length);
  const back = new Int32Array(length).fill(-1);
  // Penalty for each possible interval (in frames) between consecutive beats.
  const shortest = Math.round(period / 2);
  const longest = Math.round(2 * period);
  const penalty = Array.from({ length: longest + 1 }, (_, d) => tightness * Math.log(d / period) ** 2);
  for (let t = 0; t < length; t++) {
    let best = -Infinity;
    let from = -1;
    for (let prev = Math.max(0, t - longest); prev <= t - shortest; prev++) {
      const value = score[prev] - penalty[t - prev];
      if (value > best) [best, from] = [value, prev];
    }
    score[t] = local[t] + (from >= 0 ? Math.max(0, best) : 0);
    back[t] = from >= 0 && best > 0 ? from : -1;
  }

  // The last beat: the best score within the final period, then follow the links back.
  let t = length - 1;
  for (let i = Math.max(0, Math.round(length - period)); i < length; i++) if (score[i] > score[t]) t = i;
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t / FPS);
    t = back[t];
  }
  return beats.reverse();
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export interface TempoChanges {
  /** Whether the tempo changes enough to be followed (otherwise use a constant tempo). */
  variable: boolean;
  /** Smoothed beat times, when variable. */
  beats: number[];
  /** Slowest and fastest local tempo (BPM). */
  range: [number, number];
}

/**
 * Tracks the beats around the given tempo and decides whether the tempo really changes: local
 * tempos (over 8 beats) must differ by 6% or more. Human timing jitter alone is smoothed out.
 */
export function detectTempoChanges(notes: NoteEvent[], bpm: number): TempoChanges {
  const steady: TempoChanges = { variable: false, beats: [], range: [bpm, bpm] };
  const first = Math.min(...notes.map((n) => n.start));
  const last = Math.max(...notes.map((n) => n.start));
  const period = 60 / bpm;
  // Beyond the notes the grid continues at the edge tempo; tracked beats there are guesses.
  const raw = trackBeats(notes, bpm).filter((b) => b >= first - period / 4 && b <= last + period / 4);
  if (raw.length < 16) return steady;

  const intervals = raw.slice(1).map((b, i) => b - raw[i]);
  // The tracker must have followed the expected tempo, not half or double of it.
  if (Math.abs(median(intervals) / period - 1) > 0.15) return steady;
  // Remove jitter: median of 5 intervals, then the local tempo over 8 beats.
  const smooth = intervals.map((_, i) => median(intervals.slice(Math.max(0, i - 2), i + 3)));
  const local = smooth.map((_, i) => 60 / median(smooth.slice(Math.max(0, i - 4), i + 4)));
  const sorted = [...local].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)];
  const high = sorted[Math.floor(sorted.length * 0.9)];
  const range: [number, number] = [Math.round(low), Math.round(high)];
  if (high / low < 1.06) return { ...steady, range };

  // Rebuild the beats from the smoothed intervals, pulled halfway back to the tracked beats so
  // that rounding does not accumulate.
  const beats = [raw[0]];
  smooth.forEach((interval, i) => {
    const predicted = beats[i] + interval;
    beats.push(predicted + (raw[i + 1] - predicted) * 0.5);
  });
  return { variable: true, beats, range };
}
