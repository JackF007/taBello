// Audio → notes. Runs inside the transcription utility process (see worker.ts),
// but has no Electron dependency so it can be exercised directly from tests.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs-core';
import { loadGraphModel } from '@tensorflow/tfjs-converter';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import type { ErrorCode, NoteEvent, Sensitivity } from '../../shared/ipc';
import { MAX_DURATION_SECONDS } from '../../shared/ipc';
import { analyzeArticulation, mergeBends, packContour, pitchDeviation, transientEnvelope } from './articulation';

/** Basic Pitch expects mono audio at this rate. */
export const SAMPLE_RATE = 22050;

// Note-detection thresholds. "high" is Basic Pitch's default; the stricter ones trade a few quiet
// notes for far fewer spurious re-onsets of ringing notes (measured on synthetic plucked strings).
const THRESHOLDS: Record<Sensitivity, { onset: number; frame: number }> = {
  low: { onset: 0.7, frame: 0.45 },
  normal: { onset: 0.6, frame: 0.4 },
  high: { onset: 0.5, frame: 0.3 },
};
// 11 frames ≈ 128 ms minimum note length.
const MIN_NOTE_FRAMES = 11;
// Fast passages: 16th notes above ~115 BPM are shorter than MIN_NOTE_FRAMES. A second pass with
// 6 frames (≈ 70 ms) recovers short notes, but only clearly attacked ones: the short fragments a bend
// or slide leaves between two pitches have no onset of their own.
const FAST_NOTE_FRAMES = 6;
const FAST_NOTE_ONSET = 0.5;
// A ringing note picked again: the onset detector's peak and how much the note's activation rises.
const REPICK_ONSET = 0.65;
const REPICK_RISE = 0.2;
// Strums: a string struck again (onset of the hit), how strongly the other strings of the shape show
// it, and the spread of one strum across the strings (frames, about 60 ms).
const STRUM_HIT_ONSET = 0.6;
const STRUM_RESTRIKE_ONSET = 0.45;
const STRUM_FRAMES = 5;
const STRUM_RESTRIKE_RISE = 0.05;

export class PipelineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface DecodeOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Output format: mono at 22.05 kHz (Basic Pitch) unless set; channels come interleaved. */
  sampleRate?: number;
  channels?: number;
  /** Longest accepted input. */
  maxSeconds?: number;
}

function parseTimestamp(value: string): number {
  const [h, m, s] = value.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Decodes the first audio stream of any FFmpeg-readable file to 32-bit float PCM (mono 22.05 kHz by default). */
export function decodeAudio(ffmpegPath: string, inputPath: string, options: DecodeOptions = {}): Promise<Float32Array> {
  const rate = options.sampleRate ?? SAMPLE_RATE;
  const channels = options.channels ?? 1;
  const maxSeconds = options.maxSeconds ?? MAX_DURATION_SECONDS;
  const tooLong = () => new PipelineError('too-long', `Files longer than ${maxSeconds / 60} minutes are not supported${options.maxSeconds ? ' with this option' : ' yet'}.`);
  const args = [
    '-hide_banner', '-nostdin',
    '-i', inputPath,
    '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-ac', String(channels), '-ar', String(rate),
    // Hard cap, in case the container reports no duration.
    '-t', String(maxSeconds + 1),
    '-f', 'f32le', 'pipe:1',
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, args, { signal: options.signal, windowsHide: true });
    const chunks: Buffer[] = [];
    let stderrTail = '';
    let durationSeconds: number | null = null;
    let failure: PipelineError | null = null;

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (text: string) => {
      stderrTail = (stderrTail + text).slice(-4000);

      if (durationSeconds === null) {
        const match = /Duration: (\d+:\d+:\d+(?:\.\d+)?)/.exec(stderrTail);
        if (match) {
          durationSeconds = parseTimestamp(match[1]);
          if (durationSeconds > maxSeconds) {
            failure = tooLong();
            ffmpeg.kill();
          }
        }
      }
      const times = [...text.matchAll(/time=(\d+:\d+:\d+(?:\.\d+)?)/g)];
      if (durationSeconds && times.length > 0) {
        const elapsed = parseTimestamp(times[times.length - 1][1]);
        options.onProgress?.(Math.min(1, elapsed / durationSeconds));
      }
    });

    ffmpeg.on('error', (error) => {
      if (error.name === 'AbortError') reject(new PipelineError('cancelled', 'Transcription cancelled.'));
      else reject(new PipelineError('failed', `Could not start FFmpeg: ${error.message}`));
    });

    ffmpeg.on('close', (code) => {
      if (failure) return reject(failure);
      if (options.signal?.aborted) return reject(new PipelineError('cancelled', 'Transcription cancelled.'));
      if (code !== 0) {
        if (/matches no streams|does not contain any stream/i.test(stderrTail)) {
          return reject(new PipelineError('no-audio', 'This file does not contain an audio track.'));
        }
        const reason = stderrTail.trim().split('\n').pop() ?? `exit code ${code}`;
        return reject(new PipelineError('failed', `FFmpeg could not read this file: ${reason}`));
      }

      const bytes = Buffer.concat(chunks);
      // Copy into a fresh, aligned buffer: Buffer.concat may return a pooled, unaligned slice.
      const samples = new Float32Array(Math.floor(bytes.byteLength / 4));
      new Uint8Array(samples.buffer).set(bytes.subarray(0, samples.byteLength));
      if (samples.length === 0) return reject(new PipelineError('no-audio', 'This file does not contain any audio.'));
      if (samples.length / channels / rate > maxSeconds) return reject(tooLong());
      options.onProgress?.(1);
      resolve(samples);
    });
  });
}

/** Where the WebAssembly binaries and the Basic Pitch model live on disk. */
export interface ModelAssets {
  /** Folder containing the tfjs-backend-wasm `.wasm` files. */
  wasmDir: string;
  /** Folder containing Basic Pitch's `model.json` and weights. */
  modelDir: string;
}

let tfReady: Promise<void> | null = null;

/** Initializes TensorFlow.js with the WebAssembly backend (no native binaries needed). */
function initTensorFlow(wasmDir: string): Promise<void> {
  tfReady ??= (async () => {
    setWasmPaths(wasmDir + path.sep);
    if (!(await tf.setBackend('wasm'))) throw new PipelineError('failed', 'Could not initialize the WebAssembly backend.');
    await tf.ready();
  })();
  return tfReady;
}

/** Loads the Basic Pitch model straight from disk. */
async function loadModel(modelDir: string) {
  const manifest = JSON.parse(await readFile(path.join(modelDir, 'model.json'), 'utf8'));
  const [weightsGroup] = manifest.weightsManifest;
  const weights = await readFile(path.join(modelDir, weightsGroup.paths[0]));
  return loadGraphModel(
    tf.io.fromMemory({
      modelTopology: manifest.modelTopology,
      format: manifest.format,
      generatedBy: manifest.generatedBy,
      convertedBy: manifest.convertedBy,
      userDefinedMetadata: manifest.userDefinedMetadata,
      weightSpecs: weightsGroup.weights,
      weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
    }),
  );
}

export interface DetectNotesOptions {
  assets: ModelAssets;
  minHz: number;
  maxHz: number;
  sensitivity?: Sensitivity;
  onProgress?: (fraction: number) => void;
}

/**
 * Merges "re-triggered" notes back into the note they continue. When a new note starts, Basic Pitch
 * often reports a fresh onset for notes that are still ringing; those phantom onsets start exactly
 * where the previous same-pitch note ends and are clearly weaker, whereas a real re-pick is about as loud.
 */
export function mergeRetriggeredNotes(notes: NoteEvent[], repicks: Set<NoteEvent> = new Set()): NoteEvent[] {
  const merged: NoteEvent[] = [];
  const lastByPitch = new Map<number, NoteEvent>();
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const previous = lastByPitch.get(note.pitch);
    const gap = previous ? note.start - (previous.start + previous.duration) : Infinity;
    // A same-pitch note without any attack shortly after is the ringing note detected again.
    const contiguous = Math.abs(gap) < 0.05 || (note.attack !== undefined && note.attack < 0.2 && gap > -0.05 && gap < 0.15);
    // Weaker in loudness, or without a new attack (when the attack is known).
    const weaker =
      previous !== undefined &&
      (note.velocity < previous.velocity * 0.9 ||
        (note.attack !== undefined && previous.attack !== undefined && note.attack < 0.3 && note.attack < previous.attack * 0.5));
    // Basic Pitch also ends a decaying note early and detects it again a little later, when another
    // string is picked (a bass note under a melody). Its onset detector does not fire for such an
    // echo (it is inferred from the sustained energy), whereas it fires for a string picked again,
    // however softly.
    const echo = previous !== undefined && note.onset !== undefined && note.onset < 0.4 && gap > -0.05 && gap < 0.6;
    // A string picked again (a strum hitting it once more), even a little softer: the onset detector
    // fires clearly and the pick is heard.
    const repicked = repicks.has(note) || (note.onset !== undefined && note.onset >= 0.85 && (note.attack ?? 0) >= 0.5);
    if (previous && ((contiguous && weaker && !repicked) || (echo && !repicks.has(note)))) {
      previous.duration = Number((note.start + note.duration - previous.start).toFixed(4));
      continue;
    }
    const copy = { ...note };
    merged.push(copy);
    lastByPitch.set(note.pitch, copy);
  }
  return merged;
}

/**
 * Low notes are analysed over long windows, so Basic Pitch can hear one shortly before it is
 * plucked: a short fragment without any pick click that runs into the same pitch, clearly attacked.
 */
export function dropPreEchoes(notes: NoteEvent[]): NoteEvent[] {
  return notes.filter(
    (early) =>
      !(
        early.duration < 0.25 &&
        early.attack !== undefined &&
        early.attack < 0.2 &&
        notes.some(
          (real) =>
            real !== early &&
            real.pitch === early.pitch &&
            real.start > early.start &&
            real.start - early.start < 0.3 &&
            real.start - (early.start + early.duration) < 0.05 &&
            (real.attack ?? 1) >= 0.5,
        )
      ),
  );
}

/**
 * Basic Pitch can notice a note of a strummed chord a few hundred milliseconds late, once the louder
 * strings have decayed; it then infers the note without an onset. Such a note, starting shortly after
 * a chord that was clearly attacked (and before anything else is), belongs to that chord.
 */
export function alignInferredOnsets(notes: NoteEvent[]): NoteEvent[] {
  const strong = notes.filter((n) => (n.onset ?? 1) >= 0.6).sort((a, b) => a.start - b.start);
  return notes.map((note) => {
    if (note.onset === undefined || note.onset >= 0.4) return note;
    // The latest clearly attacked note before this one, and the chord it belongs to.
    const before = strong.filter((s) => s.start <= note.start - 0.03 && s.start >= note.start - 0.3);
    const last = before.at(-1);
    if (!last) return note;
    const chord = before.filter((s) => last.start - s.start <= 0.06);
    if (chord.length < 2 || chord.some((s) => s.pitch === note.pitch)) return note;
    const start = Math.min(...chord.map((s) => s.start));
    return { ...note, start, duration: Number((note.duration + note.start - start).toFixed(4)) };
  });
}

// Intervals (in semitones) at which a string's overtones are often mistaken for extra notes.
const HARMONIC_INTERVALS = new Set([12, 19, 24]);

/**
 * Drops notes that are most likely overtones of a louder note starting at the same time:
 * an octave, octave + fifth or two octaves above it, and much quieter.
 */
export function removeHarmonics(notes: NoteEvent[]): NoteEvent[] {
  return notes.filter(
    (note) =>
      !notes.some(
        (base) =>
          base !== note &&
          Math.abs(base.start - note.start) < 0.05 &&
          HARMONIC_INTERVALS.has(note.pitch - base.pitch) &&
          // Much quieter; or, on a bright string (an acoustic guitar), a little quieter, dying away
          // long before the note it belongs to and sounding with nothing else (a bass picked alone by
          // the thumb, the fingers coming in after) — an octave played on purpose, or within a
          // chord, rings like the rest.
          (note.velocity < base.velocity * 0.6 ||
            (note.velocity < base.velocity * 0.8 &&
              note.duration < base.duration * 0.6 &&
              !notes.some((other) => other !== note && other !== base && Math.abs(other.start - base.start) < 0.05))),
      ),
  );
}

/** Runs polyphonic pitch detection on mono 22.05 kHz audio. */
export async function detectNotes(audio: Float32Array, options: DetectNotesOptions): Promise<NoteEvent[]> {
  await initTensorFlow(options.assets.wasmDir);
  // Basic Pitch is typed against the umbrella `@tensorflow/tfjs` package; the GraphModel is the same class.
  const basicPitch = new BasicPitch(loadModel(options.assets.modelDir) as unknown as ConstructorParameters<typeof BasicPitch>[0]);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  // Pitch contours (3 bins per semitone) reveal bends, slides and vibrato; bytes are precise enough.
  const contours: Uint8Array[] = [];
  await basicPitch.evaluateModel(
    audio,
    (f, o, c) => {
      for (const row of f) frames.push(row);
      for (const row of o) onsets.push(row);
      for (const row of c) contours.push(packContour(row));
    },
    (fraction) => options.onProgress?.(fraction),
  );

  const { onset, frame } = THRESHOLDS[options.sensitivity ?? 'normal'];
  const events = outputToNotesPoly(frames, onsets, onset, frame, MIN_NOTE_FRAMES, true, options.maxHz, options.minHz);
  const onsetStrength = (event: (typeof events)[number]) => {
    let strongest = 0;
    for (let f = Math.max(0, event.startFrame - 2); f <= event.startFrame + 2; f++) strongest = Math.max(strongest, onsets[f]?.[event.pitchMidi - 21] ?? 0);
    return strongest;
  };
  const overlaps = (a: (typeof events)[number], b: (typeof events)[number]) =>
    a.pitchMidi === b.pitchMidi && a.startFrame < b.startFrame + b.durationFrames && b.startFrame < a.startFrame + a.durationFrames;
  // A real short note holds its pitch; a fragment of a bend or slide glides through it.
  const steady = (event: (typeof events)[number]) => {
    const deviations = pitchDeviation(contours, event).filter((d): d is number => d !== null);
    // Too little contour to tell: no evidence of a glide.
    if (deviations.length < 3) return true;
    return Math.max(...deviations) - Math.min(...deviations) <= 0.5 && Math.abs(deviations[deviations.length >> 1]) <= 0.34;
  };
  for (const fast of outputToNotesPoly(frames, onsets, onset, frame, FAST_NOTE_FRAMES, true, options.maxHz, options.minHz)) {
    if (onsetStrength(fast) < FAST_NOTE_ONSET || !steady(fast)) continue;
    if (!events.some((e) => overlaps(e, fast))) events.push(fast);
  }
  // A string picked again while it still rings (a bass note repeated under an arpeggio): the onset
  // detector fires and the note's activation, which had decayed, comes back up. Other strings'
  // attacks also stir the onset detector, more weakly, and without bringing the ringing note back
  // up. Basic Pitch sometimes keeps one long note (it is split here) and sometimes splits it itself;
  // either way the second note is a real pick, not an echo for mergeRetriggeredNotes to undo.
  const repickAt = (pitch: number, f: number) => {
    const strength = onsets[f]?.[pitch] ?? 0;
    if (strength < REPICK_ONSET) return false;
    for (let d = -3; d <= 3; d++) if ((onsets[f + d]?.[pitch] ?? 0) > strength) return false;
    const before = Math.min(...frames.slice(Math.max(0, f - 4), f + 1).map((row) => row[pitch]));
    const after = Math.max(...frames.slice(f, f + 9).map((row) => row[pitch]));
    return after - before >= REPICK_RISE;
  };
  const repicks = new Set<(typeof events)[number]>();
  for (const event of events) {
    const pitch = event.pitchMidi - 21;
    const continues = events.some((e) => e !== event && e.pitchMidi === event.pitchMidi && Math.abs(e.startFrame + e.durationFrames - event.startFrame) <= 3);
    if (!continues) continue;
    for (let f = event.startFrame - 3; f <= event.startFrame + 3; f++) if (repickAt(pitch, f)) repicks.add(event);
  }
  // (The pieces split off are scanned too: a bass can be picked several times while it rings.)
  for (let k = 0; k < events.length; k++) {
    const event = events[k];
    const pitch = event.pitchMidi - 21;
    const end = event.startFrame + event.durationFrames;
    for (let f = event.startFrame + MIN_NOTE_FRAMES; f < end - MIN_NOTE_FRAMES; f++) {
      if (!repickAt(pitch, f)) continue;
      const repick = { ...event, startFrame: f, durationFrames: end - f };
      events.push(repick);
      repicks.add(repick);
      event.durationFrames = f - event.startFrame;
      break;
    }
  }
  // Strumming: the fretting hand holds a shape and the picking hand strikes its strings again and
  // again. Strings still ringing are struck once more, but their activation hardly changes, so only
  // the strings that had stopped (often the bass) come out as new notes. When a string is struck again
  // (a hit), the strings struck together with it before that show an onset peak at the same moment
  // are split into new notes there — if three strings or more are struck in all, so that the stir
  // one plucked string causes in another (fingerpicking, a pinch) is not mistaken for a strum.
  const restrikes = new Set<(typeof events)[number]>();
  const hits = events.filter((e) => (onsets[e.startFrame]?.[e.pitchMidi - 21] ?? 0) >= STRUM_HIT_ONSET).sort((a, b) => a.startFrame - b.startFrame);
  for (const hit of hits) {
    const t = hit.startFrame;
    const struck: { event: (typeof events)[number]; frame: number }[] = [];
    for (const ringing of events) {
      if (ringing.pitchMidi === hit.pitchMidi || ringing.startFrame > t - 4 || ringing.startFrame + ringing.durationFrames < t + 4) continue;
      // Struck together with this string before (a note of the same pitch within a strum's spread).
      const together = events.some((e) => e.pitchMidi === hit.pitchMidi && e.startFrame < t && Math.abs(e.startFrame - ringing.startFrame) <= STRUM_FRAMES);
      if (!together) continue;
      const pitch = ringing.pitchMidi - 21;
      let frame = -1;
      for (let f = t - 2; f <= t + 2; f++) if ((onsets[f]?.[pitch] ?? 0) >= STRUM_RESTRIKE_ONSET && (frame < 0 || onsets[f][pitch] > onsets[frame][pitch])) frame = f;
      if (frame < 0) continue;
      // Struck again, a string stops dying away: its activation comes back up a little.
      const before = Math.min(...frames.slice(Math.max(0, frame - 3), frame + 1).map((row) => row[pitch]));
      const after = Math.max(...frames.slice(frame, frame + 7).map((row) => row[pitch]));
      if (after - before >= STRUM_RESTRIKE_RISE) struck.push({ event: ringing, frame });
    }
    // A strum: three strings or more struck at once, new notes and strings struck again together.
    const fresh = events.filter((e) => Math.abs(e.startFrame - t) <= STRUM_FRAMES && !restrikes.has(e)).length;
    if (struck.length === 0 || fresh + struck.length < 3) continue;
    for (const { event, frame } of struck) {
      const end = event.startFrame + event.durationFrames;
      const restruck = { ...event, startFrame: frame, durationFrames: end - frame };
      event.durationFrames = frame - event.startFrame;
      events.push(restruck);
      repicks.add(restruck);
      restrikes.add(restruck);
    }
  }
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  const context = { onsets, contours, transients: transientEnvelope(audio) };
  const repicked = new Set<NoteEvent>();
  const notes = noteFramesToTime(events)
    .map((note, i) => {
      const event: NoteEvent = {
        start: round(note.startTimeSeconds, 4),
        duration: round(note.durationSeconds, 4),
        pitch: note.pitchMidi,
        velocity: round(note.amplitude, 3),
        ...analyzeArticulation(events[i], note.startTimeSeconds, context),
      };
      if (repicks.has(events[i])) repicked.add(event);
      return event;
    })
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  // Overtones are checked again once the notes they belong to have their full length.
  return mergeBends(alignInferredOnsets(removeHarmonics(mergeRetriggeredNotes(dropPreEchoes(removeHarmonics(notes)), repicked)))).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
