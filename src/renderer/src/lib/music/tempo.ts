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
 * How strongly each note marks a beat, as a listener hears it: louder, picked notes more, and above
 * all a note in the low register (a bass note) or a long note (one that rings for a beat or more),
 * which in an even stream of 8ths tell the beats from the off-beats.
 */
export function noteAccents(notes: NoteEvent[], period: number): number[] {
  const sorted = notes.map((n) => n.pitch).sort((a, b) => a - b);
  const lowRegister = Math.min(sorted[Math.floor(sorted.length * 0.2)] ?? 0, (sorted[Math.floor(sorted.length / 2)] ?? 0) - 1);
  // Notes in start order, to find the notes struck with each one.
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start);
  const lowest = new Array<boolean>(notes.length).fill(true);
  for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length && notes[order[b]].start - notes[order[a]].start < 0.03; b++) {
      const [i, j] = [order[a], order[b]];
      if (notes[i].pitch < notes[j].pitch) lowest[j] = false;
      else if (notes[j].pitch < notes[i].pitch) lowest[i] = false;
    }
  }
  // A bass under other parts (fingerstyle, a guitar with a bass line): not a bass line played alone.
  const layered = notes.filter((n) => n.pitch >= lowRegister + 12).length >= notes.length * 0.3;
  return notes.map((note, i) => {
    // The thumb plays the beat: the bass weighs more than anything else.
    const bass = layered && lowest[i] && note.pitch <= lowRegister ? 2 : 0;
    const length = Math.min(1, note.duration / (2 * period));
    return 1 + bass + length;
  });
}

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
  // Onset strength: each note's loudness (picked notes count more than legato ones) and accent
  // (bass and long notes), spread ±20 ms.
  const accents = noteAccents(notes, 60 / bpm);
  for (const [i, note] of notes.entries()) {
    const frame = Math.round(note.start * FPS);
    // The pick click counts a little (a soft thumb on the bass has hardly any).
    const weight = note.velocity * (note.attack === undefined ? 1 : 0.7 + 0.3 * note.attack) * accents[i];
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
  // A constant tempo must also stay with the beats over the whole piece: a drift too small to call a
  // tempo change (a tenth of a BPM) still adds up to half a beat over six minutes. The straight line
  // through the tracked beats is the best constant grid; if it strays from them by more than a
  // 16th note (a quarter of a beat), the beats are followed.
  const n = raw.length;
  const meanIndex = (n - 1) / 2;
  const meanTime = raw.reduce((sum, t) => sum + t, 0) / n;
  const slope = raw.reduce((sum, t, i) => sum + (i - meanIndex) * (t - meanTime), 0) / raw.reduce((sum, _, i) => sum + (i - meanIndex) ** 2, 0);
  const residuals = raw.map((t, i) => t - (meanTime + slope * (i - meanIndex)));
  // Smoothed over 16 beats: a drift is slow and steady, unlike a few misplaced beats.
  const drift = Math.max(...residuals.map((_, i) => Math.abs(median(residuals.slice(Math.max(0, i - 8), i + 8)))));
  if (high / low < 1.06 && drift < slope / 4) return { ...steady, range };

  // Rebuild the beats from the smoothed intervals, pulled halfway back to the tracked beats so
  // that rounding does not accumulate.
  const beats = [raw[0]];
  smooth.forEach((interval, i) => {
    const predicted = beats[i] + interval;
    beats.push(predicted + (raw[i + 1] - predicted) * 0.5);
  });
  return { variable: true, beats, range };
}

export interface ClickGrid {
  /** Every beat, the clicks and the beats between them (a click under a loud strum may be missed). */
  beats: number[];
  bpm: number;
  /** Beats per bar from the accented clicks, when the metronome has an accent. */
  beatsPerBar: number | null;
  /** Indices in `beats` of the accented beats (first beats of bars). */
  downbeats: number[];
}

/** The beats a metronome gives: its clicks, with any beat it was not found on filled in. */
export function clickGrid(track: { clicks: number[]; accents: number[]; period: number }): ClickGrid {
  const clicks = [...track.clicks].sort((a, b) => a - b);
  const beats: number[] = [];
  clicks.forEach((t, i) => {
    if (i > 0) {
      const gap = t - clicks[i - 1];
      const missing = Math.round(gap / track.period) - 1;
      for (let k = 1; k <= missing; k++) beats.push(clicks[i - 1] + (k * gap) / (missing + 1));
    }
    beats.push(t);
  });
  const accented = track.accents.map((a) => beats.findIndex((b) => Math.abs(b - a) < 0.02)).filter((i) => i >= 0);
  // Beats per bar: the most common distance between accents (2 to 6 beats).
  const counts = new Map<number, number>();
  accented.slice(1).forEach((d, i) => {
    const spacing = d - accented[i];
    if (spacing >= 2 && spacing <= 6) counts.set(spacing, (counts.get(spacing) ?? 0) + 1);
  });
  const [beatsPerBar, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  // Downbeats: accents a whole number of bars apart (any other is a click taken for an accent).
  const downbeats =
    beatsPerBar === null ? [] : accented.filter((d, i) => accented.some((e, j) => j !== i && Math.abs(e - d) % beatsPerBar === 0 && e !== d));
  return {
    beats,
    bpm: Math.round(600 / track.period) / 10,
    beatsPerBar: beatsPerBar !== null && count >= 3 ? beatsPerBar : null,
    downbeats,
  };
}

/**
 * Where the bars start with a metronome's accents: which beat (0-based from the beat at or before
 * the first note) is a downbeat, as detectMeter reports it. Null without accents.
 */
export function clickBarPhase(grid: ClickGrid, firstNoteStart: number): number | null {
  if (!grid.beatsPerBar || grid.downbeats.length === 0 || grid.beats.length < 2) return null;
  const anchor = anchorBeat(beatGrid(grid.beats), firstNoteStart);
  const downbeat = grid.downbeats.reduce((best, d) => (Math.abs(d - anchor) < Math.abs(best - anchor) ? d : best));
  return (((downbeat - anchor) % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar;
}
