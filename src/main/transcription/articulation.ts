// How each note was played, from Basic Pitch's onset activations and pitch contours:
// attack strength (picked or legato), bends, slides into/out of the note, and vibrato.
import type { NoteEvent } from '../../shared/ipc';

/** Basic Pitch frame rate (22050 Hz / 256-sample hop). */
export const FRAMES_PER_SECOND = 22050 / 256;
/** Contour bins per semitone; bin 0 is A0 (MIDI 21). */
const BINS_PER_SEMITONE = 3;
/** How far from the note's pitch the contour is followed (3 semitones). */
const TOLERANCE_BINS = 9;
/** Contours are stored as bytes (activation × 255); frames below this have no clear pitch. */
const MIN_CONTOUR = 0.3 * 255;
/**
 * Smallest glide recorded, in semitones. Fast slides fade from the contours after half a
 * semitone or so; whether a glide is a slide is decided with the neighbouring notes (see arrange).
 */
const MIN_GLIDE = 0.5;

export interface FrameNote {
  startFrame: number;
  durationFrames: number;
  pitchMidi: number;
}

export type Articulation = Pick<NoteEvent, 'attack' | 'bend' | 'release' | 'slideIn' | 'slideOut' | 'vibrato'>;

export interface ArticulationContext {
  /** Basic Pitch onset activations, per frame and key. */
  onsets: number[][];
  /** Basic Pitch pitch contours, per frame (see packContour). */
  contours: Uint8Array[];
  /** High-frequency energy of the audio (see transientEnvelope). */
  transients: Float32Array;
}

/** Hop of the transient envelope, in samples at 22.05 kHz (≈ 5.8 ms). */
const TRANSIENT_HOP = 128;

/**
 * Energy of the audio's first difference (a gentle high-pass) per hop. Picking a string makes a
 * broadband click; hammer-ons, pull-offs, slides and bends change the pitch without one.
 */
export function transientEnvelope(audio: Float32Array): Float32Array {
  const out = new Float32Array(Math.ceil(audio.length / TRANSIENT_HOP));
  for (let i = 1; i < audio.length; i++) {
    const d = audio[i] - audio[i - 1];
    out[(i / TRANSIENT_HOP) | 0] += d * d;
  }
  return out;
}

/** How strongly the high-frequency energy jumps at this time, 0 (none) to 1 (a clear pluck). */
export function pluckStrength(transients: Float32Array, seconds: number): number {
  const hop = Math.round((seconds * 22050) / TRANSIENT_HOP);
  // Basic Pitch can place onsets a few tens of milliseconds late, so the click is searched for
  // from 60 ms before the onset, against the background before that.
  const before = Array.from(transients.subarray(Math.max(0, hop - 26), Math.max(0, hop - 10)));
  const after = Math.max(...Array.from(transients.subarray(Math.max(0, hop - 10), hop + 5)), 0);
  const floor = before.length > 0 ? median(before) : 0;
  const ratio = after / (floor + 1e-7);
  // Twice the background energy is nothing special; sixteen times is a pick attack.
  return Math.min(1, Math.max(0, (Math.log2(ratio) - 1) / 3));
}

/** Quantizes a contour row (activations 0..1) to bytes, which is plenty and saves memory. */
export function packContour(row: number[]): Uint8Array {
  return Uint8Array.from(row, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/**
 * Pitch deviation of a note from its nominal pitch, in semitones, frame by frame (null where the
 * contour is too weak). The pitch is followed continuously from the note's own bin, at most 2 bins
 * (⅔ semitone) per frame, so it cannot jump to another note of a chord; bends are slower than that.
 */
export function pitchDeviation(contours: Uint8Array[], note: FrameNote): (number | null)[] {
  const center = BINS_PER_SEMITONE * (note.pitchMidi - 21);
  const out: (number | null)[] = [];
  let bin: number | null = null;
  for (let f = note.startFrame; f < note.startFrame + note.durationFrames; f++) {
    const row = contours[f];
    if (!row) {
      out.push(null);
      continue;
    }
    let best = -1;
    let bestBin: number = bin ?? center;
    if (bin === null) {
      // Until the pitch is found: the strongest bin near the note, favouring its nominal pitch (a note
      // can start a little off, e.g. slid into).
      for (let b = Math.max(0, center - TOLERANCE_BINS); b <= Math.min(row.length - 1, center + TOLERANCE_BINS); b++) {
        const weighted = row[b] * Math.exp(-((b - center) ** 2) / (2 * 6 ** 2));
        if (weighted > best) [best, bestBin] = [weighted, b];
      }
      best = row[bestBin];
    } else {
      for (let b = Math.max(center - TOLERANCE_BINS, bin - 2); b <= Math.min(row.length - 1, center + TOLERANCE_BINS, bin + 2); b++) {
        if (row[b] > best) [best, bestBin] = [row[b], b];
      }
    }
    if (best >= MIN_CONTOUR) {
      bin = bestBin;
      out.push((bin - center) / BINS_PER_SEMITONE);
    } else {
      out.push(null);
    }
  }
  return out;
}

/**
 * Follows the note's pitch ridge in the contours past its end (or before its start), where Basic
 * Pitch no longer counts it as the same note: a slide or bend moves it continuously to another
 * pitch. Returns where the ridge ends up, in semitones from the note's pitch.
 */
export function followRidge(contours: Uint8Array[], note: FrameNote, direction: 1 | -1, fromDeviation = 0): number {
  const center = BINS_PER_SEMITONE * (note.pitchMidi - 21);
  let bin = center + Math.round(fromDeviation * BINS_PER_SEMITONE);
  let frame = direction === 1 ? note.startFrame + note.durationFrames - 1 : note.startFrame;
  let farthest = bin;
  // Only a continuous ridge counts: a jump to another pitch is a new note, not a glide. (A fast
  // slide fades the contour after its first steps, which is still enough to tell it apart.)
  for (let step = 0; step < 16; step++) {
    frame += direction;
    const row = contours[frame];
    if (!row) break;
    let best = -1;
    let bestBin = bin;
    for (let b = Math.max(0, bin - 3); b <= Math.min(row.length - 1, bin + 3); b++) {
      if (row[b] > best) [best, bestBin] = [row[b], b];
    }
    if (best < MIN_CONTOUR * 0.6) break;
    bin = bestBin;
    if (Math.abs(bin - center) > Math.abs(farthest - center)) farthest = bin;
  }
  return (farthest - center) / BINS_PER_SEMITONE;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round = (value: number, step: number) => Math.round(value / step) * step;

export function analyzeArticulation(note: FrameNote, startSeconds: number, context: ArticulationContext): Articulation {
  const { contours, transients } = context;
  // Attack: the pick click in the audio. (Basic Pitch's onset activation is no help here: it fires on
  // any sudden pitch change, hammer-ons included, and stays low for a picked note that an overtone of
  // another string was already sounding.)
  const attack = pluckStrength(transients, startSeconds);
  const result: Articulation = { attack: Number(attack.toFixed(3)) };

  // Smoothed pitch deviation (median of 3) over the frames with a clear pitch.
  const raw = pitchDeviation(contours, note);
  const valid = raw.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
  if (valid.length < 6) {
    const into = followRidge(contours, note, -1);
    const out = followRidge(contours, note, 1);
    if (Math.abs(into) >= MIN_GLIDE) result.slideIn = Number(into.toFixed(1));
    if (Math.abs(out) >= MIN_GLIDE) result.slideOut = Number(out.toFixed(1));
    return result;
  }
  const dev = valid.map((_, k) => median(valid.slice(Math.max(0, k - 1), k + 2).map((p) => p.v)));
  const head = median(dev.slice(0, 3));
  const tail = median(dev.slice(-3));
  const body = median(dev.slice(Math.floor(dev.length / 4), Math.ceil((dev.length * 3) / 4)));

  // A quick glide at the start is a slide into the note; a slower rise is a bend.
  const peak = Math.max(...dev);
  const rise = peak - head;
  const reached = dev.findIndex((v) => v >= head + rise * 0.75);
  const sustained = dev.filter((v) => v >= peak - 0.25).length >= 3;
  if (rise >= 0.75 && sustained && valid[reached].i > 5) {
    result.bend = Math.min(3, round(rise, 0.5));
    if (tail <= head + rise * 0.4 && reached < dev.length - 3) result.release = true;
  } else {
    // A glide into the note, inside it or just before it.
    const into = Math.abs(head - body) >= 0.75 ? head - body : followRidge(contours, note, -1, head) - body;
    if (Math.abs(into) >= MIN_GLIDE) result.slideIn = Number(into.toFixed(1));
  }
  if (!result.release) {
    const out = Math.abs(tail - body) >= 0.75 ? tail - body : followRidge(contours, note, 1, tail) - body;
    if (Math.abs(out) >= MIN_GLIDE) result.slideOut = Number(out.toFixed(1));
  }

  // Vibrato: a regular wobble of at least ±0.15 semitone at 4–9 Hz over 300 ms or more.
  const seconds = dev.length / FRAMES_PER_SECOND;
  if (seconds >= 0.3 && result.bend === undefined) {
    const window = 9;
    const wobble = dev.map((v, k) => v - median(dev.slice(Math.max(0, k - window), k + window + 1)));
    const crossings = wobble.slice(1).filter((v, k) => Math.sign(v) !== Math.sign(wobble[k]) && v !== 0).length;
    const rms = Math.sqrt(wobble.reduce((s, v) => s + v * v, 0) / wobble.length);
    const rate = crossings / 2 / seconds;
    if (rms >= 0.15 && rate >= 4 && rate <= 9) result.vibrato = true;
  }
  return result;
}

/**
 * A bend that goes past the next semitone shows up as two notes: the picked note, then the bent
 * pitch starting right where it ends, without a new attack. Merges those back into one bent note,
 * along with a release back to the original pitch.
 */
export function mergeBends(notes: NoteEvent[]): NoteEvent[] {
  const sorted = notes.map((n) => ({ ...n })).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const removed = new Set<NoteEvent>();
  const end = (n: NoteEvent) => n.start + n.duration;
  const weakAfter = (next: NoteEvent, previous: NoteEvent) =>
    next.attack !== undefined && previous.attack !== undefined && next.attack < 0.5 && next.attack < previous.attack * 0.7;
  // The glide between the two can fall outside both notes (up to ~150 ms for a slow bend).
  const follows = (next: NoteEvent, previous: NoteEvent) => next.start >= end(previous) - 0.05 && next.start <= end(previous) + 0.15;

  for (const note of sorted) {
    if (removed.has(note) || note.attack === undefined) continue;
    const bent = sorted.find(
      (n) =>
        !removed.has(n) &&
        n !== note &&
        follows(n, note) &&
        n.pitch - note.pitch >= 1 &&
        n.pitch - note.pitch <= 2 &&
        weakAfter(n, note) &&
        ((note.slideOut ?? 0) >= n.pitch - note.pitch - 0.5 || (n.slideIn ?? 0) <= -(n.pitch - note.pitch) + 0.5),
    );
    if (!bent) continue;
    removed.add(bent);
    note.bend = bent.pitch - note.pitch;
    note.duration = Number((end(bent) - note.start).toFixed(4));
    delete note.slideOut;
    if (bent.vibrato) note.vibrato = true;
    const back = sorted.find(
      (n) => !removed.has(n) && n.pitch === note.pitch && follows(n, bent) && weakAfter(n, note) && ((bent.slideOut ?? 0) <= -0.5 || (n.slideIn ?? 0) >= 0.5),
    );
    if (back) {
      removed.add(back);
      note.release = true;
      note.duration = Number((end(back) - note.start).toFixed(4));
    }
  }
  return sorted.filter((n) => !removed.has(n));
}
