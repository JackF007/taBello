// Synthetic guitar-like recordings for tests: additive plucked strings whose pitch can move while
// they ring, so techniques (hammer-ons, slides, bends, vibrato) can be rendered with known answers.

export const RATE = 22050;

export interface PitchSegment {
  /** Seconds from the note's start. */
  at: number;
  /** MIDI pitch reached at `at`. */
  pitch: number;
  /** Seconds to glide from the previous pitch (0 = jump, as a fret change). */
  glide?: number;
}

export interface SynthNote {
  start: number;
  duration: number;
  /** Starting pitch, then later pitch changes without a new pluck. */
  pitch: number;
  changes?: PitchSegment[];
  /** Vibrato depth in semitones (rate 5.5 Hz). */
  vibrato?: number;
  amplitude?: number;
}

function pitchAt(note: SynthNote, t: number): number {
  let pitch = note.pitch;
  let from = note.pitch;
  for (const change of note.changes ?? []) {
    const glide = change.glide ?? 0;
    if (t < change.at) break;
    from = pitch;
    pitch = t < change.at + glide ? from + ((change.pitch - from) * (t - change.at)) / glide : change.pitch;
    if (t < change.at + glide) return pitch + (note.vibrato ?? 0) * Math.sin(2 * Math.PI * 5.5 * t);
  }
  return pitch + (note.vibrato ?? 0) * Math.sin(2 * Math.PI * 5.5 * t);
}

/** Renders the notes; a deterministic noise burst marks each pluck. */
export function renderStrings(notes: SynthNote[], seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  let seed = 7;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) * 2 - 1;
  for (const note of notes) {
    const start = Math.round(note.start * RATE);
    const length = Math.round(note.duration * RATE);
    const phases = new Float64Array(12);
    const amplitude = note.amplitude ?? 0.5;
    for (let i = 0; i < length && start + i < out.length; i++) {
      const t = i / RATE;
      const f = 440 * 2 ** ((pitchAt(note, t) - 69) / 12);
      // Release at the end so notes do not click.
      const envelope = Math.exp(-t * 1.5) * Math.min(1, (length - i) / (0.01 * RATE));
      let sample = 0;
      for (let k = 1; k <= 12; k++) {
        phases[k - 1] += (2 * Math.PI * f * k) / RATE;
        if (f * k < RATE / 2) sample += (Math.sin(phases[k - 1]) / k) * Math.exp(-t * 0.8 * k);
      }
      // The pluck: a short burst of noise.
      const pluck = i < 0.008 * RATE ? noise() * (1 - i / (0.008 * RATE)) * 0.6 : 0;
      out[start + i] += amplitude * (sample * envelope + pluck);
    }
  }
  const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  return peak === 0 ? out : out.map((x) => (x / peak) * 0.8);
}
